/**
 * Busca e filtro local da página Relatórios.
 */
import { reportTypeCategory } from "./reports-validation.mjs";

export function normalizeReportSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function reportMatchesTypeFilter(report, typeFilter) {
  const filter = String(typeFilter || "all").toLowerCase();
  if (filter === "all") return true;
  const category = report?.typeCategory || reportTypeCategory(report?.fileExtension);
  if (filter === "pdf") return category === "pdf";
  if (filter === "document") return category === "document";
  if (filter === "spreadsheet") return category === "spreadsheet";
  if (filter === "presentation") return category === "presentation";
  if (filter === "other") return category === "other";
  return true;
}

export function reportMatchesSearch(report, searchText) {
  const query = normalizeReportSearchText(searchText);
  if (!query) return true;
  const haystack = [
    report?.title,
    report?.description,
    report?.responsibleEmail,
    report?.fileName,
  ]
    .filter(Boolean)
    .map((item) => normalizeReportSearchText(item))
    .join(" ");
  return haystack.includes(query);
}

export function filterReports(reports, { search = "", type = "all" } = {}) {
  return (reports || [])
    .filter((report) => reportMatchesSearch(report, search))
    .filter((report) => reportMatchesTypeFilter(report, type));
}

export function sortReportsByDateDesc(reports) {
  return [...(reports || [])].sort((a, b) => {
    const left = Date.parse(a?.createdAt || "") || 0;
    const right = Date.parse(b?.createdAt || "") || 0;
    return right - left;
  });
}

export function formatReportFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(value / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function reportFileTypeLabel(extension) {
  const ext = String(extension || "").toLowerCase();
  if (ext === "pdf") return "PDF";
  if (["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) return "Documento";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "Planilha";
  if (["ppt", "pptx", "odp"].includes(ext)) return "Apresentação";
  return ext ? ext.toUpperCase() : "Arquivo";
}
