/**
 * Metadados analytics.reports + Storage analytics-reports (Auth/Business Data).
 * JWT da sessão — nunca service role. Nunca BASE QV.
 */
import { randomUUID } from "node:crypto";
import { buildAnalyticsRestHeaders } from "../data/analytics-rest.mjs";
import { reportTypeCategory } from "./reports-validation.mjs";
import {
  classifyReportsPostgrestError,
  logReportsPostgrest,
  parsePostgrestErrorBody,
} from "./reports-postgrest-error.mjs";

export const REPORTS_BUCKET = "analytics-reports";
const TABLE = "reports";

const PUBLIC_SELECT = [
  "id",
  "title",
  "description",
  "file_name",
  "storage_path",
  "mime_type",
  "file_extension",
  "file_size_bytes",
  "responsible_email",
  "created_by",
  "created_at",
  "updated_at",
  "status",
].join(",");

export function buildReportStoragePath({ fileId, safeFileName, now = new Date() }) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `reports/${y}/${m}/${fileId}_${safeFileName}`;
}

function storageHeaders(accessToken, extra = {}) {
  const { url, anonKey, headers } = buildAnalyticsRestHeaders({ accessToken, write: true });
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

export const reportsStore = {
  async list({ accessToken } = {}) {
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: false });
    const endpoint = new URL(`/rest/v1/${TABLE}`, url);
    endpoint.searchParams.set("select", PUBLIC_SELECT);
    endpoint.searchParams.set("status", "eq.published");
    endpoint.searchParams.set("order", "created_at.desc");
    const response = await fetch(endpoint, { method: "GET", headers });
    if (!response.ok) {
      const detail = await response.text();
      throwReportsPostgrestError("reports list", response, detail);
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  },

  async findById(id, { accessToken } = {}) {
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: false });
    const endpoint = new URL(`/rest/v1/${TABLE}`, url);
    endpoint.searchParams.set("select", PUBLIC_SELECT);
    endpoint.searchParams.set("id", `eq.${id}`);
    endpoint.searchParams.set("status", "eq.published");
    endpoint.searchParams.set("limit", "1");
    const response = await fetch(endpoint, { method: "GET", headers });
    if (!response.ok) {
      const detail = await response.text();
      throwReportsPostgrestError("reports find", response, detail);
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] || null : null;
  },

  async insert(row, { accessToken } = {}) {
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: true });
    const endpoint = new URL(`/rest/v1/${TABLE}`, url);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation",
      },
      body: JSON.stringify([row]),
    });
    if (!response.ok) {
      const detail = await response.text();
      throwReportsPostgrestError("reports insert", response, detail);
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : rows;
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
    if (response.status === 404) {
      return { removed: false, missing: true, status: 404 };
    }
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`storage delete: HTTP ${response.status} ${detail.slice(0, 240)}`);
      error.status = response.status;
      error.code = "storage_delete_failed";
      throw error;
    }
    return { removed: true, missing: false, status: response.status };
  },

  async deleteById(id, { accessToken } = {}) {
    const { url, headers } = buildAnalyticsRestHeaders({ accessToken, write: true });
    const endpoint = new URL(`/rest/v1/${TABLE}`, url);
    endpoint.searchParams.set("id", `eq.${id}`);
    endpoint.searchParams.set("status", "eq.published");
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=minimal" },
    });
    if (!response.ok) {
      const detail = await response.text();
      throwReportsPostgrestError("reports delete", response, detail);
    }
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
