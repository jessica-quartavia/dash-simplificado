/**
 * Infra global de exportação CSV (UTF-8 BOM, separador ;, Excel PT-BR).
 */
import { getPageById } from "./pages.js";

export const CSV_SEPARATOR = ";";
const TZ = "America/Sao_Paulo";

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const percentFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatExtractedAt(date = new Date(), timeZone = TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${day} ${time}`;
}

export function normalizeFilename(slug, now = new Date(), { includeTime = true } = {}) {
  const day = now.toISOString().slice(0, 10);
  const safe = String(slug || "pagina")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!includeTime) return `analytics_${safe}_${day}.csv`;
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `analytics_${safe}_${day}_${hh}${mm}.csv`;
}

export function escapeCsv(value, separator = CSV_SEPARATOR) {
  const text = value == null ? "" : String(value);
  if (text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  if (text.includes(separator) || /[\r\n]/.test(text)) {
    return `"${text}"`;
  }
  return text;
}

export function formatCsvValue(raw, options = {}) {
  const { type, nullLabel = "Não informado" } = options;
  if (raw == null || raw === "") {
    return type === "boolean" ? "" : nullLabel === false ? "" : nullLabel;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    if (type === "percent") return `${percentFmt.format(raw)}%`;
    return numberFmt.format(raw);
  }
  if (type === "boolean") {
    if (raw === true) return "Sim";
    if (raw === false) return "Não";
    return "";
  }
  if (type === "date") {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return nullLabel === false ? "" : nullLabel;
    return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  }
  if (type === "percent" && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return `${percentFmt.format(n)}%`;
  }
  if (typeof raw === "object") return "";
  const text = String(raw);
  if (text === "undefined" || text === "NaN" || text === "[object Object]") return "";
  return text;
}

export function buildMetadataSection({ pageTitle, extractedAt, filters = [] }) {
  const lines = [
    ["# METADADOS"],
    ["campo", "valor"],
    ["pagina", pageTitle || ""],
    ["extraido_em", extractedAt || ""],
  ];
  for (const row of filters) {
    lines.push([row.label, row.value ?? ""]);
  }
  return lines;
}

export function buildKpiSection(title, rows) {
  const header = title ? [`# ${title}`] : ["# KPIS"];
  return [header, ["metrica", "valor"], ...(rows || []).map((r) => [r.metric, r.value])];
}

export function buildTableSection(title, columns, rows) {
  const headers = (columns || []).map((c) => (typeof c === "string" ? c : c.header));
  const keys = (columns || []).map((c, i) => (typeof c === "string" ? c : c.key ?? headers[i]));
  const types = (columns || []).map((c) => (typeof c === "object" ? c.type : undefined));
  const body = (rows || []).map((row) =>
    keys.map((key, idx) => {
      const val = typeof key === "function" ? key(row) : row?.[key];
      return formatCsvValue(val, { type: types[idx] });
    }),
  );
  return [[`# ${title}`], headers, ...body];
}

export function buildDistributionSection(title, items) {
  return [
    [`# ${title}`],
    ["rotulo", "quantidade", "percentual"],
    ...(items || []).map((item) => [
      item.label ?? "",
      formatCsvValue(item.count, { type: "number", nullLabel: "" }),
      item.percent == null ? "" : formatCsvValue(item.percent, { type: "percent", nullLabel: "" }),
    ]),
  ];
}

export function sectionsToCsvText(sections, separator = CSV_SEPARATOR) {
  const chunks = [];
  for (const section of sections || []) {
    if (!section?.length) continue;
    if (chunks.length) chunks.push([]);
    for (const row of section) {
      chunks.push(row.map((cell) => escapeCsv(cell, separator)).join(separator));
    }
  }
  return `\uFEFF${chunks.join("\r\n")}`;
}

export function createCsvBlob(csvText) {
  return new Blob([csvText], { type: "text/csv;charset=utf-8" });
}

export function downloadCsv(csvText, filename) {
  if (typeof document === "undefined") return csvText;
  const blob = csvText instanceof Blob ? csvText : createCsvBlob(csvText);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "analytics_export.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return csvText;
}

export function buildPageCsvDocument({ pageId, pageTitle, slug, extractedAt, filterRows, sections }) {
  const title = pageTitle || getPageById(pageId)?.title || pageId || "Analytics";
  const meta = buildMetadataSection({ pageTitle: title, extractedAt, filters: filterRows });
  return sectionsToCsvText([meta, ...(sections || [])]);
}

export function resolvePageSlug(pageId, contractSlug) {
  if (contractSlug) return contractSlug;
  return getPageById(pageId)?.hash || pageId;
}
