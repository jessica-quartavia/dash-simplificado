/**
 * Metadados analytics.reports + Storage analytics-reports (Auth/Business Data).
 * Metadados via RPC em public (evita PGRST106 / Accept-Profile: analytics).
 * JWT da sessão — nunca service role. Nunca BASE QV.
 */
import { randomUUID } from "node:crypto";
import { buildPublicRestHeaders } from "../data/analytics-public-rest.mjs";
import { reportTypeCategory } from "./reports-validation.mjs";
import {
  classifyReportsPostgrestError,
  logReportsPostgrest,
  parsePostgrestErrorBody,
} from "./reports-postgrest-error.mjs";

export const REPORTS_BUCKET = "analytics-reports";

async function callReportsRpc(functionName, body, { accessToken, prefer } = {}) {
  const { url, headers } = buildPublicRestHeaders({ accessToken, write: true });
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, url);
  const requestHeaders = { ...headers };
  if (prefer) requestHeaders.Prefer = prefer;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body ?? {}),
  });
  const detail = await response.text();
  if (!response.ok) {
    throwReportsPostgrestError(`reports rpc ${functionName}`, response, detail);
  }
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export function buildReportStoragePath({ fileId, safeFileName, now = new Date() }) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `reports/${y}/${m}/${fileId}_${safeFileName}`;
}

function storageHeaders(accessToken, extra = {}) {
  const { url, anonKey, headers } = buildPublicRestHeaders({ accessToken, write: false });
  return {
    baseUrl: url,
    headers: {
      apikey: anonKey,
      Authorization: headers.Authorization,
      ...extra,
    },
  };
}

function throwReportsPostgrestError(context, response, detail) {
  const classification = classifyReportsPostgrestError(response.status, detail);
  logReportsPostgrest(context, response.status, detail, classification);
  const pg = parsePostgrestErrorBody(detail);
  const error = new Error(`${context}: HTTP ${response.status} ${(pg.message || detail).slice(0, 240)}`);
  error.status = response.status;
  error.code = classification.code;
  error.category = classification.category;
  error.postgrestCode = classification.postgrestCode;
  throw error;
}

function parseStorageErrorBody(detail) {
  if (!detail) return {};
  try {
    return JSON.parse(detail);
  } catch {
    return { message: String(detail).slice(0, 500) };
  }
}

function isStorageObjectMissing(status, parsed = {}, raw = "") {
  const msg = String(parsed?.message || parsed?.error || raw || "").toLowerCase();
  return status === 404
    || parsed?.error === "not_found"
    || parsed?.statusCode === "404"
    || msg.includes("object not found")
    || msg.includes("not found");
}

export const reportsStore = {
  async list({ accessToken } = {}) {
    const rows = await callReportsRpc("list_published_reports", {}, { accessToken });
    return Array.isArray(rows) ? rows : [];
  },

  async findById(id, { accessToken } = {}) {
    const row = await callReportsRpc("get_published_report", { p_id: id }, { accessToken });
    return row && typeof row === "object" ? row : null;
  },

  async insert(row, { accessToken } = {}) {
    const inserted = await callReportsRpc(
      "insert_published_report",
      {
        p_title: row.title,
        p_description: row.description ?? "",
        p_file_name: row.file_name,
        p_storage_path: row.storage_path,
        p_mime_type: row.mime_type,
        p_file_extension: row.file_extension,
        p_file_size_bytes: row.file_size_bytes,
        p_responsible_email: row.responsible_email,
        p_created_by: row.created_by,
      },
      { accessToken },
    );
    return inserted;
  },

  async uploadFile({ accessToken, storagePath, body, contentType }) {
    const { baseUrl, headers } = storageHeaders(accessToken, {
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "false",
    });
    const encoded = storagePath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const endpoint = `${baseUrl}/storage/v1/object/${REPORTS_BUCKET}/${encoded}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`storage upload: HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      error.code = response.status === 404 ? "reports_bucket_missing" : "storage_upload_failed";
      throw error;
    }
  },

  async deleteFile({ accessToken, storagePath }) {
    const { baseUrl, headers } = storageHeaders(accessToken);
    const encoded = storagePath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const endpoint = `${baseUrl}/storage/v1/object/${REPORTS_BUCKET}/${encoded}`;
    const response = await fetch(endpoint, { method: "DELETE", headers });
    const detail = await response.text();
    const parsed = parseStorageErrorBody(detail);
    if (isStorageObjectMissing(response.status, parsed, detail)) {
      return {
        removed: false,
        missing: true,
        status: response.status,
        storageCode: parsed?.error || parsed?.statusCode || "not_found",
        storageMessage: parsed?.message || "Object not found",
        bucket: REPORTS_BUCKET,
        storagePath,
      };
    }
    if (!response.ok) {
      const error = new Error(`storage delete: HTTP ${response.status} ${(parsed?.message || detail).slice(0, 240)}`);
      error.status = response.status;
      error.code = "storage_delete_failed";
      error.storageCode = parsed?.error || parsed?.statusCode || parsed?.code || null;
      error.storageMessage = parsed?.message || String(detail).slice(0, 240);
      error.bucket = REPORTS_BUCKET;
      error.storagePath = storagePath;
      throw error;
    }
    return {
      removed: true,
      missing: false,
      status: response.status,
      storageCode: null,
      storageMessage: null,
      bucket: REPORTS_BUCKET,
      storagePath,
    };
  },

  async deleteById(id, { accessToken } = {}) {
    await callReportsRpc("delete_published_report", { p_id: id }, { accessToken });
  },

  async createSignedUrl({ accessToken, storagePath, expiresIn = 3600 }) {
    const { baseUrl, headers } = storageHeaders(accessToken, {
      "Content-Type": "application/json",
    });
    const encoded = storagePath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const endpoint = `${baseUrl}/storage/v1/object/sign/${REPORTS_BUCKET}/${encoded}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ expiresIn }),
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`storage sign: HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      error.code = "storage_sign_failed";
      throw error;
    }
    const payload = await response.json();
    const signedPath = payload?.signedURL || payload?.signedUrl;
    if (!signedPath) throw new Error("storage sign: resposta inválida.");
    if (/^https?:\/\//i.test(signedPath)) return signedPath;
    return `${baseUrl}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
  },

  newFileId() {
    return randomUUID();
  },

  toPublicRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      fileName: row.file_name,
      storagePath: row.storage_path,
      mimeType: row.mime_type,
      fileExtension: row.file_extension,
      fileSizeBytes: row.file_size_bytes,
      responsibleEmail: row.responsible_email,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
      typeCategory: reportTypeCategory(row.file_extension),
    };
  },
};
