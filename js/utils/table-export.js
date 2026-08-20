/**
 * Exportação de tabelas filtradas (CSV UTF-8 BOM + XLSX real).
 * Sempre recebe as linhas já recortadas. Allowlist obrigatória.
 */
import { buildXlsx } from "./xlsx-minimal.mjs";

export function exportFilename(pageSlug, extension, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const slug = String(pageSlug || "pagina").replace(/[^\w-]+/g, "_");
  return `analytics-quartavia_${slug}_${day}.${extension}`;
}

function cellValue(row, column) {
  const raw = typeof column.value === "function" ? column.value(row) : row?.[column.key];
  if (raw == null || raw === "") return "";
  if (column.type === "date") {
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (column.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : "";
  }
  if (column.type === "boolean") {
    if (raw === true) return "Sim";
    if (raw === false) return "Não";
    return "";
  }
  return String(raw);
}

export function projectExportRows(rows, columns) {
  return (rows || []).map((row) => {
    const out = {};
    for (const column of columns || []) {
      out[column.header] = cellValue(row, column);
    }
    return out;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv({ rows, columns }) {
  const projected = projectExportRows(rows, columns);
  const headers = (columns || []).map((column) => column.header);
  const lines = [
    headers.map(csvEscape).join(","),
    ...projected.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function buildExcelSheets({ rows, columns, filters = [] }) {
  const projected = projectExportRows(rows, columns);
  const headers = (columns || []).map((column) => column.header);
  const dataRows = [
    headers,
    ...projected.map((row) => headers.map((header) => {
      const value = row[header];
      const column = columns.find((item) => item.header === header);
      if (column?.type === "number" && value !== "") return Number(value);
      return value;
    })),
  ];
  const filterRows = [["Filtro", "Valor"], ...filters.map((item) => [item.label, item.value])];
  return [
    { name: "Dados", rows: dataRows },
    { name: "Filtros aplicados", rows: filterRows.length > 1 ? filterRows : [["Filtro", "Valor"], ["Nenhum", "—"]] },
  ];
}

export function buildExcelBuffer({ rows, columns, filters = [] }) {
  return buildXlsx(buildExcelSheets({ rows, columns, filters }));
}

function downloadBlob(contents, filename, mime) {
  const blob = contents instanceof Blob
    ? contents
    : new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportToCsv({ rows, columns, filename, filters: _filters } = {}) {
  const csv = buildCsv({ rows, columns });
  if (typeof document === "undefined") return csv;
  downloadBlob(csv, filename, "text/csv;charset=utf-8");
  return csv;
}

export function exportToExcel({ rows, columns, filename, filters = [] } = {}) {
  const buffer = buildExcelBuffer({ rows, columns, filters });
  if (typeof document === "undefined") return buffer;
  downloadBlob(buffer, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return buffer;
}

export function filterSummaryRows(filters = {}, labels = {}) {
  return Object.entries(labels).map(([key, label]) => ({
    label,
    value: filters[key] == null || filters[key] === "" ? "Todos" : String(filters[key]),
  }));
}
