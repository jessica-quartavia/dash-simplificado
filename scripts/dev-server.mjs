import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuthConfigResult } from "../lib/env.mjs";
import {
  DASHBOARD_LEGACY_PATHS,
  handleDashboardApi,
} from "../lib/api/dashboard-router.mjs";
import {
  ANALYTICS_LEGACY_PATHS,
  handleAnalyticsApi,
} from "../lib/api/analytics-router.mjs";
import assistantHandler from "../api/assistant.js";
import reportsHandler from "../api/reports.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};

  for (const line of text.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

function loadLocalEnv() {
  const fromEnv = parseEnvFile(join(ROOT, ".env")) || {};
  const fromLocal = parseEnvFile(join(ROOT, ".env.local")) || {};
  const merged = { ...fromEnv, ...fromLocal };

  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value;
  }

  return {
    envFile: existsSync(join(ROOT, ".env")),
    envLocalFile: existsSync(join(ROOT, ".env.local")),
    authUrl: Boolean(String(process.env.AUTH_SUPABASE_URL || "").trim()),
    authAnonKey: Boolean(String(process.env.AUTH_SUPABASE_ANON_KEY || "").trim()),
    dataUrl: Boolean(String(process.env.DATA_SUPABASE_URL || "").trim()),
    dataKey: Boolean(String(process.env.DATA_SUPABASE_SERVICE_ROLE_KEY || "").trim()),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body, extraHeaders = {}) {
  send(res, status, JSON.stringify(body), {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "/index.html" : decoded;
  const resolved = resolve(ROOT, `.${normalize(relative)}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

function normalizeApiPath(pathname) {
  const base = String(pathname || "/");
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

function isDashboardRoute(apiPath) {
  return apiPath === "/api/dashboard" || apiPath in DASHBOARD_LEGACY_PATHS;
}

function isAnalyticsRoute(apiPath) {
  return apiPath === "/api/analytics" || apiPath in ANALYTICS_LEGACY_PATHS;
}

function invokeHandler(label, handler, req, res, fallbackCode, fallbackMessage) {
  loadLocalEnv();
  void handler(req, res).catch((error) => {
    console.error(`[dev] ${label}`, error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: fallbackMessage, code: fallbackCode });
    }
  });
}

loadLocalEnv();

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const apiPath = normalizeApiPath(url.pathname);

  if (apiPath === "/api/auth-config") {
    loadLocalEnv();
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" }, {
        "Cache-Control": "no-store",
      });
      return;
    }
    const result = buildAuthConfigResult();
    sendJson(res, result.status, result.body, result.headers);
    return;
  }

  if (isDashboardRoute(apiPath)) {
    invokeHandler(apiPath, handleDashboardApi, req, res, "data_query_failed", "Não foi possível consultar o dashboard.");
    return;
  }

  if (isAnalyticsRoute(apiPath)) {
    invokeHandler(apiPath, handleAnalyticsApi, req, res, "analytics_query_failed", "Não foi possível consultar analytics.");
    return;
  }

  if (apiPath === "/api/assistant") {
    invokeHandler(apiPath, assistantHandler, req, res, "assistant_failed", "Não foi possível processar a pergunta agora.");
    return;
  }

  if (apiPath === "/api/reports") {
    invokeHandler(apiPath, reportsHandler, req, res, "reports_failed", "Não foi possível processar a solicitação de relatórios.");
    return;
  }

  if (apiPath.startsWith("/api/")) {
    const code = apiPath.startsWith("/api/reports") ? "reports_api_unavailable" : "local_api_unavailable";
    sendJson(res, 404, {
      error: "API não disponível neste servidor local.",
      code,
    }, { "Cache-Control": "no-store" });
    return;
  }

  const filePath = safeFilePath(url.pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const type = MIME[extname(filePath)] || "application/octet-stream";
  send(res, 200, readFileSync(filePath), { "Content-Type": type });
});

server.listen(PORT, () => {
  const loaded = loadLocalEnv();
  const fnCount = 5;
  console.log(`Analytics QuartaVia V2 em http://localhost:${PORT}`);
  console.log(
    `[env] .env=${loaded.envFile ? "sim" : "não"} .env.local=${loaded.envLocalFile ? "sim" : "não"} AUTH=${loaded.authUrl && loaded.authAnonKey ? "ok" : "ausente"} DATA=${loaded.dataUrl && loaded.dataKey ? "ok" : "ausente"} API_FUNCTIONS=${fnCount}`,
  );
});
