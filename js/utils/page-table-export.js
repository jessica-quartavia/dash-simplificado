import { formatPeriodSummary } from "../../lib/analytics/filters/period.mjs";
import { getPageFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";
import { exportFilename, exportToCsv, exportToExcel } from "./table-export.js";

const STATUS_LABELS = {
  active: "Ativos",
  active_or_frozen: "Ativos e congelados",
  frozen: "Congelados",
  cancelled: "Cancelados",
  cancelled_no_date: "Cancelados sem confirmação",
  unknown: "Não informado",
  all: "Todos",
};

function pretty(value) {
  if (value == null || value === "" || value === "all") return "Todos";
  return STATUS_LABELS[value] || String(value);
}

export function currentFilterSummary(filters = {}, extras = {}) {
  return [
    { label: "Período", value: formatPeriodSummary(filters) },
    { label: "Status", value: pretty(filters.status) },
    { label: "EP", value: pretty(filters.engineer) },
    { label: "Segmento", value: pretty(filters.segment) },
    { label: "Busca", value: String(filters.search || "").trim() || "—" },
    ...Object.entries(extras).map(([label, value]) => ({ label, value: pretty(value) })),
  ];
}

export function exportFilteredTable({ pageId, rows, filters, format, extraFilterLabels = {} }) {
  const contract = getPageFilterContract(pageId);
  if (!contract) throw new Error("Filter Contract ausente para exportação.");
  const columns = contract.exportColumns;
  const filename = exportFilename(contract.slug, format === "xlsx" ? "xlsx" : "csv");
  const filterRows = currentFilterSummary(filters, extraFilterLabels);
  if (format === "xlsx") {
    return exportToExcel({ rows, columns, filename, filters: filterRows });
  }
  return exportToCsv({ rows, columns, filename, filters: filterRows });
}
