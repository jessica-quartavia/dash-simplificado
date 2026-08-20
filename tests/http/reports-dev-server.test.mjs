import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import reportsHandler from "../../api/reports.js";
import { handleReportsRequest } from "../../lib/analytics/reports-handler.mjs";
import { nodeToWebRequest } from "../../lib/http/node-fetch-bridge.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function mockReq({ method = "GET", url = "/api/reports", headers = {}, body = null } = {}) {
  const payload = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const req = payload.length ? Readable.from([payload]) : Readable.from([]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost:3000",
    ...headers,
  };
  return req;
}

test("dev-server registra rotas consolidadas dashboard/analytics/reports", () => {
  const source = readFileSync(resolve(root, "scripts/dev-server.mjs"), "utf8");
  assert.match(source, /handleDashboardApi/);
  assert.match(source, /handleAnalyticsApi/);
  assert.match(source, /reportsHandler/);
  assert.doesNotMatch(source, /generalDataHandler/);
  assert.doesNotMatch(source, /catalogHandler/);
});

test("404 de API local inclui code reports_api_unavailable", () => {
  const source = readFileSync(resolve(root, "scripts/dev-server.mjs"), "utf8");
  assert.match(source, /reports_api_unavailable/);
});

test("GET /api/reports sem auth retorna 401 via handler Vercel", async () => {
  const req = mockReq({ method: "GET", url: "/api/reports" });
  const request = await nodeToWebRequest(req);
  const response = await handleReportsRequest(request, {
    requireCorporateAuthUser: async () => ({
      error: Response.json({ error: "Não autenticado.", code: "unauthenticated" }, { status: 401 }),
    }),
  });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.code, "unauthenticated");
});

test("GET /api/reports autenticado retorna lista vazia", async () => {
  const req = mockReq({ method: "GET", url: "/api/reports", headers: { authorization: "Bearer test" } });
  const request = await nodeToWebRequest(req);
  const response = await handleReportsRequest(request, {
    requireCorporateAuthUser: async () => ({
      user: { id: "u1", email: "a@quartavia.com.br" },
      accessToken: "test",
    }),
    analyticsCatalogConfigurationError: () => null,
    reportsStore: {
      list: async () => [],
      toPublicRow: (row) => row,
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.reports, []);
});

test("multipart/form-data preserva arquivo binário no bridge", async () => {
  const boundary = "----cursorboundary";
  const pdfBytes = Buffer.from("%PDF-1.4 binary");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nRelatório teste\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="teste.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    pdfBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const req = mockReq({
    method: "POST",
    url: "/api/reports",
    headers: {
      authorization: "Bearer test",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
    body,
  });

  const request = await nodeToWebRequest(req);
  assert.match(request.headers.get("content-type"), /multipart\/form-data/);
  const formData = await request.formData();
  assert.equal(formData.get("title"), "Relatório teste");
  const file = formData.get("file");
  assert.ok(file instanceof Blob);
  assert.equal(file.name, "teste.pdf");
  const saved = Buffer.from(await file.arrayBuffer());
  assert.equal(saved.toString("utf8"), pdfBytes.toString("utf8"));
});

test("POST /api/reports via api/reports.js preserva multipart (não vira body vazio)", async () => {
  const boundary = "----cursorboundary2";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nTítulo\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n`,
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  const req = mockReq({
    method: "POST",
    url: "/api/reports",
    headers: {
      authorization: "Bearer test",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const res = {
    headersSent: false,
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(payload) {
      this.body = payload;
    },
  };

  await reportsHandler(req, res);
  const payload = JSON.parse(res.body.toString());
  assert.notEqual(payload.code, "invalid_form");
  assert.notEqual(payload.code, "missing_file");
  assert.ok([401, 503].includes(res.statusCode), `status=${res.statusCode} code=${payload.code}`);
});

test("bridge não força Content-Type JSON quando multipart já veio", async () => {
  const req = mockReq({
    method: "POST",
    url: "/api/reports",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: Buffer.from("--x--\r\n"),
  });
  const request = await nodeToWebRequest(req);
  assert.match(request.headers.get("content-type"), /^multipart\/form-data/);
});
