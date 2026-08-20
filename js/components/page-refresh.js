/**
 * Botão global Atualizar + timestamp da última carga bem-sucedida.
 */
import { escapeHtml } from "../general-charts.mjs";

const TZ = "America/Sao_Paulo";

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

export function renderPageRefresh({
  buttonId = "pageRefreshBtn",
  loading = false,
  enabled = true,
  lastUpdatedAt = null,
  now = new Date(),
  error = "",
} = {}) {
  const label = loading ? "Atualizando..." : "Atualizar";
  const timestamp = lastUpdatedAt ? formatLastUpdated(lastUpdatedAt, now) : "";
  const meta = timestamp
    ? `<p class="page-refresh-meta" title="Último carregamento dos dados desta página.">Última atualização: ${escapeHtml(timestamp)}</p>`
    : `<p class="page-refresh-meta page-refresh-meta--empty" title="Último carregamento dos dados desta página."></p>`;
  const errorHtml = error
    ? `<p class="page-refresh-error" role="status">${escapeHtml(error)}</p>`
    : `<p class="page-refresh-error" role="status" hidden></p>`;

  return `
    <div class="page-refresh">
      <button
        class="btn btn-secondary"
        type="button"
        id="${escapeHtml(buttonId)}"
        ${enabled && !loading ? "" : "disabled"}
        aria-busy="${loading ? "true" : "false"}"
      >${escapeHtml(label)}</button>
      ${meta}
      ${errorHtml}
    </div>
  `;
}

/**
 * Controlador compartilhado do refresh por página.
 */
export function createPageRefresh({
  hostId = "page-actions",
  buttonId = "pageRefreshBtn",
  onRefresh,
} = {}) {
  let loading = false;
  let enabled = false;
  let lastUpdatedAt = null;
  let error = "";
  let inflight = null;

  function host() {
    return document.getElementById(hostId);
  }

  function paint(now = new Date()) {
    const el = host();
    if (!el) return;
    el.innerHTML = renderPageRefresh({
      buttonId,
      loading,
      enabled,
      lastUpdatedAt,
      now,
      error,
    });
    const btn = document.getElementById(buttonId);
    btn?.addEventListener("click", handleClick);
  }

  async function handleClick() {
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
      const el = host();
      if (el) el.innerHTML = "";
    },
  };
}
