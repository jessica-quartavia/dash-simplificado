/**
 * Relatórios — validação, handler, busca e navegação.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { handleReportsRequest } from "../../lib/analytics/reports-handler.mjs";
import {
  filterReports,
  normalizeReportSearchText,
  sortReportsByDateDesc,
} from "../../lib/analytics/reports-search.mjs";
import {
  REPORTS_MAX_BYTES,
  validateReportDescription,
  validateReportFile,
  validateReportTitle,
} from "../../lib/analytics/reports-validation.mjs";
import { buildReportStoragePath, reportsStore } from "../../lib/analytics/reports-store.mjs";
import {
  classifyReportsPostgrestError,
  reportsErrorMessage,
} from "../../lib/analytics/reports-postgrest-error.mjs";
import { getPageById, PAGES } from "../../js/pages.js";
import { runFilterCheck } from "../../lib/analytics/filters/filter-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CORP_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "jessica@quartavia.com.br",
};

function jsonResponse(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function mockAuth(deps = {}) {
  return {
    requireCorporateAuthUser: async () => ({
      user: CORP_USER,
      accessToken: "test-token",
    }),
    analyticsCatalogConfigurationError: () => null,
    ...deps,
  };
}

test("Relatórios aparece em Visão Geral", () => {
  const page = getPageById("reports");
  assert.ok(page);
  assert.equal(page.group, "overview");
  assert.equal(page.implemented, true);
  const overview = PAGES.filter((item) => item.group === "overview").map((item) => item.navLabel);
  assert.deepEqual(overview, ["Resumo Executivo", "Dados Gerais", "Relatórios"]);
});

test("título obrigatório com trim e limite", () => {
  assert.equal(validateReportTitle("   ").ok, false);
  assert.equal(validateReportTitle("  Relatório  ").ok, true);
  assert.equal(validateReportTitle("  Relatório  ").value, "Relatório");
  assert.equal(validateReportTitle("x".repeat(201)).ok, false);
});

test("descrição opcional com limite", () => {
  assert.equal(validateReportDescription("").ok, true);
  assert.equal(validateReportDescription("   ").value, null);
  assert.equal(validateReportDescription("Resumo").ok, true);
  assert.equal(validateReportDescription("x".repeat(2001)).ok, false);
});

test("formatos permitidos e bloqueados", () => {
  assert.equal(validateReportFile({ name: "a.pdf", size: 1000, mimeType: "application/pdf" }).ok, true);
  assert.equal(validateReportFile({ name: "a.xlsx", size: 1000, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }).ok, true);
  assert.equal(validateReportFile({ name: "a.exe", size: 1000, mimeType: "application/octet-stream" }).ok, false);
  assert.equal(validateReportFile({ name: "a.pdf", size: 1000, mimeType: "application/x-msdownload" }).ok, false);
  assert.equal(validateReportFile({ name: "a.pdf", size: REPORTS_MAX_BYTES + 1, mimeType: "application/pdf" }).ok, false);
});

test("busca accent/case insensitive e filtro de tipo", () => {
  const rows = [
    { id: "1", title: "Análise", description: "Cancelamentos", responsibleEmail: "ana@quartavia.com.br", fileName: "a.pdf", fileExtension: "pdf", typeCategory: "pdf" },
    { id: "2", title: "Planilha", description: "Mensal", responsibleEmail: "joao@quartavia.com.br", fileName: "b.xlsx", fileExtension: "xlsx", typeCategory: "spreadsheet" },
  ];
  assert.equal(normalizeReportSearchText("Análise"), "analise");
  assert.equal(filterReports(rows, { search: "cancelamento" }).length, 1);
  assert.equal(filterReports(rows, { type: "spreadsheet" }).length, 1);
});

test("GET lista mais recente primeiro", async () => {
  const store = {
    list: async () => [
      { id: "1", title: "Antigo", file_name: "a.pdf", storage_path: "p1", file_extension: "pdf", file_size_bytes: 1, responsible_email: CORP_USER.email, created_by: CORP_USER.id, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", status: "published" },
      { id: "2", title: "Novo", file_name: "b.pdf", storage_path: "p2", file_extension: "pdf", file_size_bytes: 1, responsible_email: CORP_USER.email, created_by: CORP_USER.id, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z", status: "published" },
    ],
    toPublicRow: reportsStore.toPublicRow.bind(reportsStore),
  };
  const response = await handleReportsRequest(new Request("http://localhost/api/reports"), {
    ...mockAuth(),
    reportsStore: store,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reports[0].id, "2");
  assert.equal(sortReportsByDateDesc(payload.reports)[0].id, "2");
});

test("sem auth retorna 401", async () => {
  const response = await handleReportsRequest(new Request("http://localhost/api/reports"), {
    requireCorporateAuthUser: async () => ({ error: jsonResponse(401, { error: "Não autenticado.", code: "unauthenticated" }) }),
  });
  assert.equal(response.status, 401);
});

test("POST ignora responsible_email do client e usa sessão", async () => {
  let inserted = null;
  let deleted = false;
  const store = {
    newFileId: () => "file-uuid",
    uploadFile: async () => {},
    insert: async (row) => {
      inserted = row;
      return { ...row, id: "rep-1", created_at: "2026-08-20T15:40:00.000Z", updated_at: "2026-08-20T15:40:00.000Z" };
    },
    deleteFile: async () => {
      deleted = true;
    },
    toPublicRow: reportsStore.toPublicRow.bind(reportsStore),
  };

  const fileContent = Buffer.from("%PDF-1.4");
  const form = new FormData();
  form.append("file", new Blob([fileContent], { type: "application/pdf" }), "relatorio-clientes.pdf");
  form.append("title", "Análise de Cancelamentos");
  form.append("description", "Resumo");
  form.append("responsible_email", "spoof@evil.com");

  const response = await handleReportsRequest(
    new Request("http://localhost/api/reports", { method: "POST", body: form }),
    { ...mockAuth(), reportsStore: store },
  );
  assert.equal(response.status, 201);
  assert.equal(inserted.responsible_email, CORP_USER.email);
  assert.equal(inserted.created_by, CORP_USER.id);
  assert.equal(deleted, false);
});

test("rollback/cleanup se metadata falhar após upload", async () => {
  let deletedPath = null;
  const store = {
    newFileId: () => "file-uuid",
    uploadFile: async () => {},
    insert: async () => {
      const error = new Error("insert failed");
      error.code = "reports_insert_failed";
      throw error;
    },
    deleteFile: async ({ storagePath }) => {
      deletedPath = storagePath;
    },
    toPublicRow: reportsStore.toPublicRow.bind(reportsStore),
  };

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF")], { type: "application/pdf" }), "relatorio.pdf");
  form.append("title", "Falha controlada");

  const response = await handleReportsRequest(
    new Request("http://localhost/api/reports", { method: "POST", body: form }),
    { ...mockAuth(), reportsStore: store },
  );
  assert.equal(response.status, 503);
  assert.match(deletedPath || "", /reports\/\d{4}\/\d{2}\/file-uuid_/);
});

test("GET open retorna signed URL segura", async () => {
  const store = {
    findById: async () => ({
      id: "rep-1",
      storage_path: "reports/2026/08/id_relatorio.pdf",
      file_name: "relatorio.pdf",
    }),
    createSignedUrl: async () => "https://example.supabase.co/storage/v1/object/sign/analytics-reports/reports/2026/08/id_relatorio.pdf?token=abc",
    toPublicRow: reportsStore.toPublicRow.bind(reportsStore),
  };
  const response = await handleReportsRequest(new Request("http://localhost/api/reports?open=rep-1"), {
    ...mockAuth(),
    reportsStore: store,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.url, /^https:\/\//);
  assert.equal(payload.expiresIn, 3600);
});

test("storage path organizado e filename sanitizado", () => {
  const path = buildReportStoragePath({
    fileId: "abc",
    safeFileName: "relatorio-clientes.pdf",
    now: new Date("2026-08-20T12:00:00.000Z"),
  });
  assert.equal(path, "reports/2026/08/abc_relatorio-clientes.pdf");
});

test("frontend readonly responsável e router", () => {
  const source = readFileSync(resolve(root, "js/reports.js"), "utf8");
  const app = readFileSync(resolve(root, "js/app.js"), "utf8");
  assert.match(source, /readonly/);
  assert.match(source, /getUserEmail/);
  assert.match(source, /onPageChange/);
  assert.match(app, /bootReports/);
});

test("assistente shimmer e reduced motion", () => {
  const css = readFileSync(resolve(root, "css/assistant.css"), "utf8");
  assert.match(css, /assistant-fab-shimmer/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("classificação PostgREST não confunde PGRST106 com table missing", () => {
  const body = JSON.stringify({
    code: "PGRST106",
    message: "The schema must be one of the following: public",
  });
  const result = classifyReportsPostgrestError(406, body);
  assert.equal(result.code, "reports_schema_not_exposed");
  assert.equal(reportsErrorMessage(result.code), "Relatórios ainda não estão disponíveis pela Data API.");
});

test("classificação PostgREST permission denied", () => {
  const body = JSON.stringify({ code: "42501", message: "permission denied for table reports" });
  const result = classifyReportsPostgrestError(403, body);
  assert.equal(result.code, "reports_permission_denied");
});

test("classificação PostgREST table missing", () => {
  const body = JSON.stringify({ code: "PGRST205", message: "Could not find the table analytics.reports in the schema cache" });
  const result = classifyReportsPostgrestError(404, body);
  assert.equal(result.code, "reports_table_missing");
});

test("handler expõe schema not exposed sem pedir migração", async () => {
  const response = await handleReportsRequest(new Request("http://localhost/api/reports"), {
    ...mockAuth(),
    analyticsCatalogConfigurationError: () => null,
    reportsStore: {
      list: async () => {
        const error = new Error("schema");
        error.code = "reports_schema_not_exposed";
        throw error;
      },
      toPublicRow: (row) => row,
    },
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "reports_schema_not_exposed");
  assert.doesNotMatch(payload.error, /migração/i);
});

test("filter check de relatórios", () => {
  const result = runFilterCheck();
  assert.equal(result.reports.ok, true, JSON.stringify(result.reports.checks.filter((item) => !item.ok)));
});
