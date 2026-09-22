/**
 * Rótulos de filtros para metadata do CSV (sem alterar regras de filtro).
 */
import { formatPeriodSummary } from "./filters/period.mjs";
import { getPageFilterContract } from "./filters/page-contracts.mjs";
import { getPageById } from "../../js/pages.js";

const STATUS_LABELS = {
  active: "Ativos",
  active_or_frozen: "Ativos e congelados",
  frozen: "Congelados",
  cancelled: "Cancelados",
  cancelled_no_date: "Cancelados sem confirmação",
  unknown: "Não informado",
  all: "Todos",
};

export function prettyFilterValue(value) {
  if (value == null || value === "" || value === "all") return "Todos";
  if (Array.isArray(value)) {
    if (!value.length) return "Todos";
    return value.join(", ");
  }
  return STATUS_LABELS[value] || String(value);
}

export function buildPageFilterMetadata(pageId, filters = {}, extras = []) {
  const contract = getPageFilterContract(pageId);
  const ui = new Set(contract?.uiFilters || []);
  const rows = [];

  if (ui.has("period")) {
    rows.push({ label: "Período", value: formatPeriodSummary(filters) || "Todos" });
  }
  if (ui.has("search")) {
    rows.push({ label: "Busca", value: String(filters.search || "").trim() || "—" });
  }
  if (ui.has("status")) {
    rows.push({ label: "Status", value: prettyFilterValue(filters.status) });
  }
  if (ui.has("engineer") || ui.has("engineerMultiselect")) {
    rows.push({ label: "EP", value: prettyFilterValue(filters.engineer) });
  }
  if (ui.has("segment")) {
    rows.push({ label: "Segmento", value: prettyFilterValue(filters.segment) });
  }
  if (ui.has("program")) {
    rows.push({ label: "Programa", value: prettyFilterValue(filters.program) });
  }
  if (ui.has("classification")) {
    rows.push({ label: "Classificação", value: prettyFilterValue(filters.classification) });
  }
  if (ui.has("quarter")) {
    rows.push({ label: "Trimestre", value: prettyFilterValue(filters.quarter) });
  }
  if (ui.has("npsClassification")) {
    rows.push({ label: "Classificação NPS", value: prettyFilterValue(filters.npsClassification) });
  }
  if (ui.has("hasCsat")) {
    rows.push({ label: "Possui CSAT", value: prettyFilterValue(filters.hasCsat) });
  }
  if (ui.has("lastNpsBand")) {
    rows.push({ label: "Faixa último NPS", value: prettyFilterValue(filters.lastNpsBand) });
  }
  if (ui.has("cancellationStage")) {
    rows.push({ label: "Etapa", value: prettyFilterValue(filters.cancellationStage) });
  }
  if (ui.has("reasonCategory")) {
    rows.push({ label: "Motivo (categoria)", value: prettyFilterValue(filters.reasonCategory) });
  }
  if (ui.has("responsible")) {
    rows.push({ label: "Responsável", value: prettyFilterValue(filters.responsible) });
  }
  if (ui.has("renewed")) {
    rows.push({ label: "Renovou", value: prettyFilterValue(filters.renewed) });
  }
  if (ui.has("domain")) {
    rows.push({ label: "Domínio", value: prettyFilterValue(filters.domain) });
  }
  if (ui.has("severity")) {
    rows.push({ label: "Preenchimento", value: prettyFilterValue(filters.severity) });
  }
  if (ui.has("month")) {
    rows.push({ label: "Mês", value: prettyFilterValue(filters.month) });
  }
  if (ui.has("cancelWindow")) {
    rows.push({ label: "Janela cancelamento", value: prettyFilterValue(filters.cancelWindow) });
  }
  if (ui.has("minCoverage")) {
    rows.push({ label: "Cobertura mínima (%)", value: filters.minCoverage == null ? "—" : String(filters.minCoverage) });
  }
  if (ui.has("minSample")) {
    rows.push({ label: "Amostra mínima", value: filters.minSample == null ? "—" : String(filters.minSample) });
  }

  for (const extra of extras) {
    rows.push(extra);
  }

  return rows;
}

export function pageTitleForExport(pageId) {
  return getPageById(pageId)?.title || pageId;
}

export function contractSlugForExport(pageId) {
  return getPageFilterContract(pageId)?.slug || getPageById(pageId)?.hash || pageId;
}
