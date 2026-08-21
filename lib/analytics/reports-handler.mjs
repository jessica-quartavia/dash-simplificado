/**
 * Handler HTTP — Relatórios (schema analytics + Storage privado).
 * Responsável sempre da sessão autenticada; nunca confiar no client.
 */
import { randomUUID } from "node:crypto";
import { requireCorporateAuthUser } from "../auth.mjs";
import { analyticsCatalogConfigurationError } from "../env.mjs";
import {
  validateReportDescription,
  validateReportFile,
  validateReportTitle,
} from "./reports-validation.mjs";
import { buildReportStoragePath, reportsStore } from "./reports-store.mjs";
import { sortReportsByDateDesc } from "./reports-search.mjs";
import { reportsErrorMessage } from "./reports-postgrest-error.mjs";

function json(status, body, requestId = null) {
  const payload = requestId ? { ...body, request_id: requestId } : body;
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isDevEnvironment() {
  return process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "development";
}

function deleteErrorResponse(status, body, requestId, error) {
  const payload = { ...body, request_id: requestId };
  if (isDevEnvironment() && error) {
    payload.error_category = error.category || error.code || "unknown";
    if (error.postgrestCode) payload.postgrest_code = error.postgrestCode;
    if (error.status) payload.http_status = error.status;
  }
  return json(status, payload, requestId);
}

function mapStoreError(error) {
  const code = error?.code;
  if (code === "reports_bucket_missing") {
    return json(503, {
      error: reportsErrorMessage(code),
      code,
    });
  }
  if (code === "reports_schema_not_exposed") {
    return json(503, {
      error: reportsErrorMessage(code),
      code,
      hint: "Inclua o schema analytics em Settings → API → Exposed schemas.",
    });
  }
  if (code === "reports_permission_denied") {
    return json(503, {
      error: reportsErrorMessage(code),
      code,
      hint: "Aplique sql/analytics/007_reports_access_fix.sql no Business Data.",
    });
  }
  if (code === "reports_table_missing") {
    return json(503, {
      error: reportsErrorMessage(code),
      code,
    });
  }
  if (code === "reports_insert_failed" || code === "reports_query_failed") {
    return json(503, {
      error: "Não foi possível consultar os relatórios.",
      code,
    });
  }
  if (code === "config") {
    return json(503, { error: error.message, code: "config" });
  }
  if (code === "unauthorized") {
    return json(401, { error: reportsErrorMessage(code), code: "unauthenticated" });
  }
  return json(500, {
    error: "Não foi possível processar a solicitação de relatórios.",
    code: code || "reports_failed",
  });
}

async function requireSession(request, deps) {
  const requireAuthUser = deps.requireCorporateAuthUser || requireCorporateAuthUser;
  const result = await requireAuthUser(request);
  if (result.error) return { error: result.error };
  return { user: result.user, accessToken: result.accessToken };
}

async function handleList(accessToken, store) {
  const rows = await store.list({ accessToken });
  const reports = sortReportsByDateDesc(rows.map((row) => store.toPublicRow(row)));
  return json(200, { reports });
}

async function handleOpen(reportId, accessToken, store) {
  const id = String(reportId || "").trim();
  if (!id) return json(400, { error: "Informe o relatório a abrir.", code: "invalid_request" });
  const row = await store.findById(id, { accessToken });
  if (!row) return json(404, { error: "Relatório não encontrado.", code: "not_found" });
  const url = await store.createSignedUrl({
    accessToken,
    storagePath: row.storage_path,
    expiresIn: 3600,
  });
  return json(200, { url, expiresIn: 3600, fileName: row.file_name });
}

async function handlePublish(request, user, accessToken, store) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json(400, { error: "Envio inválido. Selecione um arquivo e tente novamente.", code: "invalid_form" });
  }

  const fileEntry = formData.get("file");
  const titleResult = validateReportTitle(formData.get("title"));
  if (!titleResult.ok) return json(400, { error: titleResult.error, code: "invalid_title" });

  const descriptionResult = validateReportDescription(formData.get("description"));
  if (!descriptionResult.ok) return json(400, { error: descriptionResult.error, code: "invalid_description" });

  if (!fileEntry || typeof fileEntry === "string") {
    return json(400, { error: "Selecione um arquivo para publicar.", code: "missing_file" });
  }

  const fileName = fileEntry.name || "arquivo";
  const fileResult = validateReportFile({
    name: fileName,
    size: fileEntry.size,
    mimeType: fileEntry.type,
  });
  if (!fileResult.ok) return json(400, { error: fileResult.error, code: "invalid_file" });

  const fileId = store.newFileId();
  const storagePath = buildReportStoragePath({
    fileId,
    safeFileName: fileResult.safeFileName,
  });

  const body = Buffer.from(await fileEntry.arrayBuffer());
  await store.uploadFile({
    accessToken,
    storagePath,
    body,
    contentType: fileResult.mimeType || fileEntry.type || "application/octet-stream",
  });

  try {
    const inserted = await store.insert(
      {
        title: titleResult.value,
        description: descriptionResult.value,
        file_name: fileResult.safeFileName,
        storage_path: storagePath,
        mime_type: fileResult.mimeType || fileEntry.type || null,
        file_extension: fileResult.extension,
        file_size_bytes: fileEntry.size,
        responsible_email: user.email,
        created_by: user.id,
        status: "published",
      },
      { accessToken },
    );
    return json(201, { report: store.toPublicRow(inserted) });
  } catch (error) {
    try {
      await store.deleteFile({ accessToken, storagePath });
    } catch (cleanupError) {
      console.error(
        "[reports] metadata failed; storage cleanup also failed:",
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
        { storagePath },
      );
    }
    throw error;
  }
}

async function handleDelete(reportId, accessToken, store, user, requestId) {
  const id = String(reportId || "").trim();
  if (!id) return json(400, { error: "Informe o relatório a excluir.", code: "invalid_request" }, requestId);
  const row = await store.findById(id, { accessToken });
  if (!row) return json(404, { error: "Relatório não encontrado.", code: "not_found" }, requestId);
  if (row.created_by && user?.id && String(row.created_by) !== String(user.id)) {
    return json(403, {
      error: "Sem permissão para excluir este relatório.",
      code: "forbidden",
      hint: "Aplique sql/analytics/009_reports_delete_access.sql e confirme created_by = auth.uid().",
    }, requestId);
  }

  let storageRemoved = true;
  try {
    await store.deleteFile({ accessToken, storagePath: row.storage_path });
  } catch (error) {
    if (error?.code === "storage_delete_failed") {
      console.error(`[reports] delete storage failed id=${id} request=${requestId} status=${error.status} code=${error.code}`);
      return deleteErrorResponse(error.status === 403 ? 403 : 500, {
        error: error.status === 403
          ? "Sem permissão para remover o arquivo no Storage."
          : "Não foi possível remover o arquivo no Storage.",
        code: error.code,
      }, requestId, error);
    }
    storageRemoved = false;
  }

  try {
    await store.deleteById(id, { accessToken });
  } catch (error) {
    console.error(
      `[reports] delete metadata failed id=${id} request=${requestId} status=${error?.status || "n/a"} postgrest=${error?.postgrestCode || "n/a"} code=${error?.code || "unknown"}`,
    );
    if (error?.status === 403 || error?.code === "reports_permission_denied") {
      return deleteErrorResponse(403, {
        error: "Sem permissão para excluir este relatório.",
        code: "forbidden",
        hint: "Aplique sql/analytics/009_reports_delete_access.sql no Business Data.",
      }, requestId, error);
    }
    throw error;
  }

  return json(200, {
    ok: true,
    id,
    storageRemoved,
    message: storageRemoved
      ? "Relatório excluído."
      : "Registro excluído. O arquivo já não estava no storage.",
  }, requestId);
}

export async function handleReportsRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  const url = new URL(request.url || "/", "http://localhost");
  const openId = url.searchParams.get("open");
  const deleteId = url.searchParams.get("id");
  const store = deps.reportsStore || reportsStore;
  const requestId = randomUUID();

  if (method !== "GET" && method !== "HEAD" && method !== "POST" && method !== "DELETE") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const session = await requireSession(request, deps);
  const authMs = Date.now() - startedAt;
  if (session.error) {
    console.info(`[reports] status=${session.error.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return session.error;
  }

  const configError = (deps.analyticsCatalogConfigurationError || analyticsCatalogConfigurationError)();
  if (configError) {
    return json(503, { error: configError, code: "config" });
  }

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (method === "GET" && openId) {
      const response = await handleOpen(openId, session.accessToken, store);
      console.info(`[reports] status=${response.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
      return response;
    }
    if (method === "GET") {
      const response = await handleList(session.accessToken, store);
      console.info(`[reports] status=${response.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
      return response;
    }
    if (method === "DELETE") {
      const response = await handleDelete(deleteId, session.accessToken, store, session.user, requestId);
      console.info(`[reports] status=${response.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
      return response;
    }
    const response = await handlePublish(request, session.user, session.accessToken, store);
    console.info(`[reports] status=${response.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return response;
  } catch (error) {
    if (error?.code === "config" || error?.code === "base_qv_refused") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error(
      `[reports] failed category=${error?.category || error?.code || "unknown"} postgrest=${error?.postgrestCode || "n/a"}`,
    );
    const response = mapStoreError(error);
    console.info(`[reports] status=${response.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return response;
  }
}
