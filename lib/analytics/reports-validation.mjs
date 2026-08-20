/**
 * Validação de uploads — Relatórios (schema analytics).
 * Allowlist de extensão + MIME. Bloqueio de executáveis/scripts.
 */

export const REPORTS_MAX_BYTES = 50 * 1024 * 1024;

export const REPORTS_TITLE_MAX = 200;
export const REPORTS_DESCRIPTION_MAX = 2000;

export const REPORTS_BLOCKED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "dll",
  "ps1",
  "sh",
  "bash",
  "js",
  "mjs",
  "cjs",
  "vbs",
  "jar",
  "app",
  "scr",
  "reg",
]);

export const REPORTS_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "md",
  "rtf",
  "odt",
  "ods",
  "odp",
]);

/** MIME permitidos por extensão (validação cruzada). */
export const REPORTS_ALLOWED_MIMES = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain", "text/x-markdown"],
  rtf: ["application/rtf", "text/rtf"],
  odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
};

export const REPORT_TYPE_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "pdf", label: "PDF" },
  { value: "document", label: "Documento" },
  { value: "spreadsheet", label: "Planilha" },
  { value: "presentation", label: "Apresentação" },
  { value: "other", label: "Outros" },
];

export function fileExtension(name) {
  const base = String(name || "").trim().split(/[/\\]/).pop() || "";
  const idx = base.lastIndexOf(".");
  if (idx < 1) return "";
  return base.slice(idx + 1).toLowerCase();
}

export function sanitizeFileName(name) {
  const base = String(name || "arquivo").trim().split(/[/\\]/).pop() || "arquivo";
  const ext = fileExtension(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  const safeStem = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "arquivo";
  const safeExt = ext.replace(/[^a-z0-9]+/gi, "").slice(0, 12);
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

export function reportTypeCategory(extension) {
  const ext = String(extension || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) return "document";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "spreadsheet";
  if (["ppt", "pptx", "odp"].includes(ext)) return "presentation";
  return "other";
}

export function mimeMatchesExtension(mimeType, extension) {
  const ext = String(extension || "").toLowerCase();
  const allowed = REPORTS_ALLOWED_MIMES[ext];
  if (!allowed) return false;
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (!mime) return false;
  return allowed.some((item) => item === mime);
}

export function validateReportTitle(title) {
  const text = String(title || "").trim();
  if (!text) return { ok: false, error: "Informe um título para o relatório." };
  if (text.length > REPORTS_TITLE_MAX) {
    return { ok: false, error: `O título deve ter no máximo ${REPORTS_TITLE_MAX} caracteres.` };
  }
  return { ok: true, value: text };
}

export function validateReportDescription(description) {
  const text = String(description || "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > REPORTS_DESCRIPTION_MAX) {
    return { ok: false, error: `A descrição deve ter no máximo ${REPORTS_DESCRIPTION_MAX} caracteres.` };
  }
  return { ok: true, value: text };
}

export function validateReportFile({ name, size, mimeType }) {
  const ext = fileExtension(name);
  if (!ext) return { ok: false, error: "O arquivo precisa ter uma extensão reconhecida." };
  if (REPORTS_BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Este tipo de arquivo não é permitido." };
  }
  if (!REPORTS_ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Formato de arquivo não permitido." };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, error: "Arquivo inválido ou vazio." };
  }
  if (bytes > REPORTS_MAX_BYTES) {
    return { ok: false, error: "O arquivo excede o limite de 50 MB." };
  }
  if (mimeType && !mimeMatchesExtension(mimeType, ext)) {
    return { ok: false, error: "O tipo do arquivo não corresponde à extensão informada." };
  }
  return {
    ok: true,
    extension: ext,
    safeFileName: sanitizeFileName(name),
    mimeType: String(mimeType || "").split(";")[0].trim().toLowerCase() || null,
  };
}
