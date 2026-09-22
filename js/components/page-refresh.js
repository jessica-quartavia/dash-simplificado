/**
 * Botão global Atualizar + Baixar CSV + timestamp da última carga bem-sucedida.
 */
import { escapeHtml } from "../general-charts.mjs";
import {
  canExportPageCsv,
  clearPageExportContext,
  registerPageExportContext,
  runPageCsvExport,
} from "../page-export-registry.js";

const TZ = "America/Sao_Paulo";

const CSV_ICON = `<svg class="btn-csv-export__icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3v12m0 0l4-4m-4 4l-4-4M5 19h14v2H5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

function sameDayInTz(a, b, timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(a) === fmt.format(b);
}

function formatTimeInTz(date, timeZone = TZ) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateTimeInTz(date, timeZone = TZ) {
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return `${day} às ${formatTimeInTz(date, timeZone)}`;
}

/** Exportado para testes. */
export function formatLastUpdated(date = new Date(), now = new Date(), timeZone = TZ) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return "";
  if (sameDayInTz(target, now, timeZone)) return formatTimeInTz(target, timeZone);
  return formatDateTimeInTz(target, timeZone);
}

export function renderPageActions({
  buttonId = "pageRefreshBtn",
  csvButtonId = "pageCsvBtn",
  pageId = null,
  loading = false,
  enabled = true,
  csvLoading = false,
  csvEnabled = true,
  showCsv = false,
  lastUpdatedAt = null,
  now = new Date(),
  error = "",
  csvError = "",
} = {}) {
  const refreshLabel = loading ? "Atualizando..." : "Atualizar";
  const csvLabel = csvLoading ? "Preparando CSV..." : "Baixar CSV";
  const timestamp = lastUpdatedAt ? formatLastUpdated(lastUpdatedAt, now) : "";
  const meta = timestamp
    ? `<p class="page-refresh-meta" title="Último carregamento dos dados desta página.">Última atualização: ${escapeHtml(timestamp)}</p>`
    : `<p class="page-refresh-meta page-refresh-meta--empty" title="Último carregamento dos dados desta página."></p>`;
  const errorHtml = error
    ? `<p class="page-refresh-error" role="status">${escapeHtml(error)}</p>`
    : `<p class="page-refresh-error" role="status" hidden></p>`;
  const csvErrorHtml = csvError
    ? `<p class="page-refresh-error page-csv-error" role="status">${escapeHtml(csvError)}</p>`
    : `<p class="page-refresh-error page-csv-error" role="status" hidden></p>`;

  const csvBtn = showCsv
    ? `<button
        class="btn btn-secondary btn-csv-export"
        type="button"
        id="${escapeHtml(csvButtonId)}"
        data-page-id="${escapeHtml(pageId || "")}"
        ${csvEnabled && !csvLoading && enabled ? "" : "disabled"}
        aria-busy="${csvLoading ? "true" : "false"}"
      >${CSV_ICON}<span>${escapeHtml(csvLabel)}</span></button>`
    : "";

  return `
    <div class="page-actions-stack">
      <div class="page-actions-row">
        ${csvBtn}
        <button
          class="btn btn-secondary"
          type="button"
          id="${escapeHtml(buttonId)}"
          ${enabled && !loading ? "" : "disabled"}
          aria-busy="${loading ? "true" : "false"}"
        >${escapeHtml(refreshLabel)}</button>
      </div>
      ${meta}
      ${errorHtml}
      ${csvErrorHtml}
    </div>
  `;
}

/** @deprecated use renderPageActions */
export function renderPageRefresh(options = {}) {
  return renderPageActions(options);
}

/**
 * Controlador compartilhado do refresh por página.
 */
export function createPageRefresh({
  hostId = "page-actions",
  buttonId = "pageRefreshBtn",
  csvButtonId = "pageCsvBtn",
  pageId = null,
  getExportContext = null,
  onRefresh,
} = {}) {
  let loading = false;
  let enabled = false;
  let csvLoading = false;
  let lastUpdatedAt = null;
  let error = "";
  let csvError = "";
  let inflight = null;
  let csvInflight = null;

  if (pageId && typeof getExportContext === "function") {
    registerPageExportContext(pageId, getExportContext);
  }

  function showCsvButton() {
    return Boolean(pageId && canExportPageCsv(pageId));
  }

  function host() {
    return document.getElementById(hostId);
  }

  function paint(now = new Date()) {
    const el = host();
    if (!el) return;
    el.innerHTML = renderPageActions({
      buttonId,
      csvButtonId,
      pageId,
      loading,
      enabled,
      csvLoading,
      csvEnabled: showCsvButton() && canExportPageCsv(pageId),
      showCsv: showCsvButton(),
      lastUpdatedAt,
      now,
      error,
      csvError,
    });
    document.getElementById(buttonId)?.addEventListener("click", handleRefreshClick);
    document.getElementById(csvButtonId)?.addEventListener("click", handleCsvClick);
  }

  async function handleRefreshClick() {
    if (loading || inflight || !enabled) return;
    error = "";
    loading = true;
    paint();
    try {
      inflight = Promise.resolve(onRefresh?.({ force: true }));
      await inflight;
    } finally {
      inflight = null;
      if (loading) {
        loading = false;
        paint();
      }
    }
  }

  async function handleCsvClick() {
    if (csvLoading || csvInflight || !enabled || !showCsvButton()) return;
    csvError = "";
    csvLoading = true;
    paint();
    try {
      csvInflight = runPageCsvExport(pageId);
      await csvInflight;
    } catch {
      csvError = "Não foi possível gerar o CSV.";
    } finally {
      csvInflight = null;
      csvLoading = false;
      paint();
    }
  }

  return {
    render: paint,
    setEnabled(value) {
      enabled = Boolean(value);
      paint();
    },
    setLoading(value) {
      loading = Boolean(value);
      paint();
    },
    markSuccess(at = new Date()) {
      lastUpdatedAt = at instanceof Date ? at : new Date(at);
      error = "";
      loading = false;
      paint();
    },
    markError(message) {
      error = message || "Não foi possível atualizar os dados.";
      loading = false;
      paint();
    },
    getLastUpdatedAt() {
      return lastUpdatedAt;
    },
    destroy() {
      if (pageId) clearPageExportContext(pageId);
      const el = host();
      if (el) el.innerHTML = "";
    },
  };
}
