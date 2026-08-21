import { onPageChange, getCurrentPageId } from "./navigation.js";
import { authenticatedFetch, getAccessToken, getUserEmail } from "./auth.mjs";
import { escapeHtml } from "./general-charts.mjs";
import {
  filterReports,
  formatReportFileSize,
  reportFileTypeLabel,
  sortReportsByDateDesc,
} from "../lib/analytics/reports-search.mjs";
import {
  REPORTS_DESCRIPTION_MAX,
  REPORTS_MAX_BYTES,
  REPORTS_TITLE_MAX,
  REPORT_TYPE_FILTERS,
  validateReportFile,
  validateReportTitle,
} from "../lib/analytics/reports-validation.mjs";
import { reportsErrorMessage } from "../lib/analytics/reports-postgrest-error.mjs";

const state = {
  mounted: false,
  loading: false,
  publishing: false,
  error: null,
  success: null,
  reports: [],
  search: "",
  type: "all",
  selectedFile: null,
  openReportId: null,
  deleteReportId: null,
  deleting: false,
};

let eventsBound = false;
let fileInput = null;
let toastTimer = null;

function $(id) {
  return document.getElementById(id);
}

function dateTimeBR(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reportIconClass(extension) {
  const ext = String(extension || "").toLowerCase();
  if (ext === "pdf") return "reports-icon-pdf";
  if (["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)) return "reports-icon-doc";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "reports-icon-sheet";
  if (["ppt", "pptx", "odp"].includes(ext)) return "reports-icon-slide";
  return "reports-icon-file";
}

function visibleReports() {
  return filterReports(sortReportsByDateDesc(state.reports), {
    search: state.search,
    type: state.type,
  });
}

function setToast(message, kind = "success") {
  clearTimeout(toastTimer);
  state.success = kind === "success" ? message : null;
  state.error = kind === "error" ? message : null;
  renderToast();
  if (message) {
    toastTimer = setTimeout(() => {
      state.success = null;
      state.error = null;
      renderToast();
    }, 4200);
  }
}

function renderToast() {
  const node = $("reports-toast");
  if (!node) return;
  const message = state.success || state.error;
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    node.className = "reports-toast";
    return;
  }
  node.hidden = false;
  node.textContent = message;
  node.className = `reports-toast ${state.error ? "is-error" : "is-success"}`;
}

function renderToolbar() {
  const actions = $("page-actions");
  if (!actions) return;
  actions.innerHTML = `
    <button type="button" class="btn btn-primary" id="reports-publish-btn">+ Publicar relatório</button>
  `;
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  const options = REPORT_TYPE_FILTERS.map(
    (item) => `<option value="${escapeHtml(item.value)}"${state.type === item.value ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
  ).join("");
  host.innerHTML = `
    <div class="reports-toolbar">
      <label class="reports-search">
        <span class="sr-only">Buscar relatório</span>
        <input type="search" id="reports-search" placeholder="Buscar relatório..." value="${escapeHtml(state.search)}" autocomplete="off" />
      </label>
      <label class="reports-type-filter">
        <span>Tipo</span>
        <select id="reports-type">${options}</select>
      </label>
    </div>
  `;
}

function renderReportCard(report) {
  const typeLabel = reportFileTypeLabel(report.fileExtension);
  const sizeLabel = formatReportFileSize(report.fileSizeBytes);
  return `
    <article class="reports-card" data-report-id="${escapeHtml(report.id)}">
      <div class="reports-card-head">
        <span class="reports-file-icon ${reportIconClass(report.fileExtension)}" aria-hidden="true"></span>
        <div>
          <h3>${escapeHtml(report.title)}</h3>
          ${report.description ? `<p class="reports-card-desc">${escapeHtml(report.description)}</p>` : ""}
        </div>
      </div>
      <div class="reports-card-meta">
        <span>${escapeHtml(typeLabel)} · ${escapeHtml(sizeLabel)}</span>
        <span>Publicado por ${escapeHtml(report.responsibleEmail || "—")}</span>
        <span>${escapeHtml(dateTimeBR(report.createdAt))}</span>
      </div>
      <div class="reports-card-actions">
        <button type="button" class="btn btn-secondary reports-open-btn" data-open-report="${escapeHtml(report.id)}">
          Abrir
        </button>
        <button type="button" class="btn btn-secondary reports-download-btn" data-download-report="${escapeHtml(report.id)}" data-file-name="${escapeHtml(report.fileName || "")}">
          Baixar
        </button>
        <button type="button" class="btn btn-secondary reports-delete-btn" data-delete-report="${escapeHtml(report.id)}" aria-label="Excluir relatório" title="Excluir">
          Excluir
        </button>
      </div>
    </article>
  `;
}

function renderContent() {
  const host = $("page-content");
  if (!host) return;

  if (state.loading) {
    host.innerHTML = `<p class="reports-status">Carregando relatórios…</p>`;
    return;
  }

  if (state.error && !state.reports.length) {
    host.innerHTML = `<p class="reports-status is-error">${escapeHtml(state.error)}</p>`;
    return;
  }

  const items = visibleReports();
  if (!items.length) {
    host.innerHTML = `
      <div class="reports-empty">
        <p>${state.reports.length ? "Nenhum relatório corresponde à busca." : "Os relatórios publicados pelo time de Inteligência aparecerão aqui."}</p>
        <button type="button" class="btn btn-primary" id="reports-empty-publish">${state.reports.length ? "+ Publicar relatório" : "Publicar primeiro relatório"}</button>
      </div>
      <div id="reports-toast" class="reports-toast" hidden></div>
    `;
    renderToast();
    return;
  }

  host.innerHTML = `
    <div class="reports-grid">${items.map(renderReportCard).join("")}</div>
    <div id="reports-toast" class="reports-toast" hidden></div>
  `;
  renderToast();
}

function renderDeleteModal() {
  const existing = document.getElementById("reports-delete-modal");
  if (existing) existing.remove();
  if (!state.deleteReportId) return;

  const report = state.reports.find((item) => item.id === state.deleteReportId);
  const root = document.getElementById("overlay-root");
  if (!root) return;

  root.setAttribute("aria-hidden", "false");
  root.innerHTML = `
    <div class="reports-modal-backdrop" data-reports-delete-dismiss></div>
    <div class="reports-modal reports-delete-modal" role="dialog" aria-modal="true" aria-labelledby="reports-delete-title">
      <header class="reports-modal-head">
        <h2 id="reports-delete-title">Excluir relatório?</h2>
      </header>
      <p class="reports-delete-copy">Essa ação removerá o relatório e seu arquivo.</p>
      <div class="reports-form-actions">
        <button type="button" class="btn btn-secondary" data-reports-delete-dismiss>Cancelar</button>
        <button type="button" class="btn btn-primary reports-delete-confirm" id="reports-delete-confirm"${state.deleting ? " disabled" : ""}>${state.deleting ? "Excluindo…" : "Excluir"}</button>
      </div>
    </div>
  `;
}

function closeDeleteModal() {
  state.deleteReportId = null;
  state.deleting = false;
  const root = document.getElementById("overlay-root");
  if (!root) return;
  if (state.selectedFile) {
    renderModal();
    return;
  }
  root.innerHTML = "";
  root.setAttribute("aria-hidden", "true");
}

function renderModal() {
  const existing = document.getElementById("reports-modal");
  if (existing) existing.remove();

  if (!state.selectedFile) return;

  const email = getUserEmail() || "—";
  const root = document.getElementById("overlay-root");
  if (!root) return;

  root.setAttribute("aria-hidden", "false");
  root.innerHTML = `
    <div class="reports-modal-backdrop" data-reports-dismiss></div>
    <div class="reports-modal" role="dialog" aria-modal="true" aria-labelledby="reports-modal-title">
      <header class="reports-modal-head">
        <h2 id="reports-modal-title">Publicar relatório</h2>
      </header>
      <form id="reports-form" class="reports-form">
        <div class="reports-field">
          <span class="reports-field-label">Arquivo</span>
          <p class="reports-file-name">${escapeHtml(state.selectedFile.name)}</p>
        </div>
        <label class="reports-field">
          <span class="reports-field-label">Título *</span>
          <input type="text" id="reports-title" maxlength="${REPORTS_TITLE_MAX}" required placeholder="Título do relatório" />
        </label>
        <label class="reports-field">
          <span class="reports-field-label">Descrição</span>
          <textarea id="reports-description" maxlength="${REPORTS_DESCRIPTION_MAX}" rows="4" placeholder="Descrição opcional"></textarea>
        </label>
        <div class="reports-field">
          <span class="reports-field-label">Responsável</span>
          <input type="email" id="reports-responsible" value="${escapeHtml(email)}" readonly aria-readonly="true" tabindex="-1" />
        </div>
        <p id="reports-form-error" class="reports-form-error" hidden></p>
        <p id="reports-form-progress" class="reports-form-progress" hidden></p>
        <div class="reports-form-actions">
          <button type="button" class="btn btn-secondary" data-reports-dismiss>Cancelar</button>
          <button type="submit" class="btn btn-primary" id="reports-submit">Publicar</button>
        </div>
      </form>
    </div>
  `;
}

function closeModal() {
  state.selectedFile = null;
  const root = document.getElementById("overlay-root");
  if (root) {
    root.innerHTML = "";
    root.setAttribute("aria-hidden", "true");
  }
}

function ensureFileInput() {
  if (fileInput) return fileInput;
  fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.hidden = true;
  fileInput.accept = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.rtf,.odt,.ods,.odp";
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const validation = validateReportFile({
      name: file.name,
      size: file.size,
      mimeType: file.type,
    });
    if (!validation.ok) {
      setToast(validation.error, "error");
      return;
    }
    state.selectedFile = file;
    renderModal();
  });
  return fileInput;
}

function openFilePicker() {
  ensureFileInput().click();
}

function isReportsDebug() {
  return typeof location !== "undefined" && (location.search.includes("reportsDebug=1") || location.hostname === "localhost");
}

function mapApiError(payload, status) {
  if (status === 401) return reportsErrorMessage("unauthorized");
  if (status === 404 && (payload?.code === "reports_api_unavailable" || payload?.code === "local_api_unavailable")) {
    return "Rota /api/reports indisponível no servidor local. Reinicie com npm run dev.";
  }
  if (status === 403 || payload?.code === "forbidden") {
    const parts = [payload?.error || "Sem permissão para excluir este relatório."];
    if (payload?.hint) parts.push(payload.hint);
    if (isReportsDebug()) {
      if (payload?.error_category) parts.push(`[${payload.error_category}]`);
      if (payload?.postgrest_code) parts.push(`PostgREST ${payload.postgrest_code}`);
      if (payload?.request_id) parts.push(`req ${payload.request_id}`);
    }
    return parts.join(" ");
  }
  if (payload?.code && reportsErrorMessage(payload.code) !== "Não foi possível consultar os relatórios.") {
    return reportsErrorMessage(payload.code);
  }
  if (status === 503 && payload?.hint) {
    return `${payload.error || "Relatórios indisponíveis."} ${payload.hint}`;
  }
  return payload?.error || "Não foi possível concluir a operação.";
}

async function loadReports() {
  state.loading = true;
  state.error = null;
  renderContent();
  try {
    const response = await authenticatedFetch("/api/reports");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(mapApiError(payload, response.status));
    state.reports = Array.isArray(payload.reports) ? payload.reports : [];
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Não foi possível carregar os relatórios.";
    state.reports = [];
  } finally {
    state.loading = false;
    renderContent();
  }
}

function publishWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    if (!token) {
      reject(new Error("Sessão expirada. Faça login novamente."));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/reports");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      const node = document.getElementById("reports-form-progress");
      if (!node) return;
      node.hidden = false;
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        node.textContent = `Enviando arquivo… ${pct}%`;
      } else {
        node.textContent = "Enviando arquivo…";
      }
    };
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        payload = {};
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, payload });
    };
    xhr.onerror = () => reject(new Error("Falha de rede ao enviar o arquivo."));
    xhr.send(formData);
  });
}

async function submitPublish(event) {
  event.preventDefault();
  if (state.publishing || !state.selectedFile) return;

  const titleInput = document.getElementById("reports-title");
  const descriptionInput = document.getElementById("reports-description");
  const errorNode = document.getElementById("reports-form-error");
  const submitBtn = document.getElementById("reports-submit");
  const titleResult = validateReportTitle(titleInput?.value);
  if (!titleResult.ok) {
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = titleResult.error;
    }
    return;
  }

  state.publishing = true;
  if (errorNode) errorNode.hidden = true;
  if (submitBtn) submitBtn.disabled = true;

  const formData = new FormData();
  formData.append("file", state.selectedFile);
  formData.append("title", titleResult.value);
  formData.append("description", String(descriptionInput?.value || "").trim());
  formData.append("responsible_email", "spoof@example.com");

  try {
    const result = await publishWithProgress(formData);
    if (!result.ok) throw new Error(mapApiError(result.payload, result.status));
    closeModal();
    if (result.payload?.report) {
      state.reports = sortReportsByDateDesc([result.payload.report, ...state.reports.filter((item) => item.id !== result.payload.report.id)]);
    } else {
      await loadReports();
    }
    renderContent();
    setToast("Relatório publicado com sucesso.");
  } catch (error) {
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = error instanceof Error ? error.message : "Não foi possível publicar o relatório.";
    }
  } finally {
    state.publishing = false;
    if (submitBtn) submitBtn.disabled = false;
    const progressNode = document.getElementById("reports-form-progress");
    if (progressNode) progressNode.hidden = true;
  }
}

async function downloadReport(reportId, fileName) {
  if (state.openReportId) return;
  state.openReportId = reportId;
  try {
    const response = await authenticatedFetch(`/api/reports?open=${encodeURIComponent(reportId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(mapApiError(payload, response.status));
    if (!payload.url) throw new Error("Não foi possível gerar o link seguro.");
    const anchor = document.createElement("a");
    anchor.href = payload.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.download = fileName || payload.fileName || "relatorio";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    setToast(error instanceof Error ? error.message : "Não foi possível baixar o relatório.", "error");
  } finally {
    state.openReportId = null;
  }
}

async function deleteReport(reportId) {
  if (state.deleting) return;
  state.deleting = true;
  renderDeleteModal();
  try {
    const response = await authenticatedFetch(`/api/reports?id=${encodeURIComponent(reportId)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(mapApiError(payload, response.status));
    state.reports = state.reports.filter((item) => item.id !== reportId);
    closeDeleteModal();
    renderContent();
    setToast(payload.message || "Relatório excluído.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível excluir o relatório.";
    setToast(message, "error");
  } finally {
    state.deleting = false;
    if (state.deleteReportId) renderDeleteModal();
  }
}

async function openReport(reportId) {
  if (state.openReportId) return;
  state.openReportId = reportId;
  try {
    const response = await authenticatedFetch(`/api/reports?open=${encodeURIComponent(reportId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(mapApiError(payload, response.status));
    if (!payload.url) throw new Error("Não foi possível gerar o link seguro.");
    window.open(payload.url, "_blank", "noopener,noreferrer");
  } catch (error) {
    setToast(error instanceof Error ? error.message : "Não foi possível abrir o relatório.", "error");
  } finally {
    state.openReportId = null;
  }
}

function onContentClick(event) {
  const downloadBtn = event.target.closest("[data-download-report]");
  if (downloadBtn) {
    downloadReport(downloadBtn.getAttribute("data-download-report"), downloadBtn.getAttribute("data-file-name"));
    return;
  }
  const openBtn = event.target.closest("[data-open-report]");
  if (openBtn) {
    openReport(openBtn.getAttribute("data-open-report"));
    return;
  }
  const deleteBtn = event.target.closest("[data-delete-report]");
  if (deleteBtn) {
    state.deleteReportId = deleteBtn.getAttribute("data-delete-report");
    renderDeleteModal();
    return;
  }
  if (event.target.id === "reports-empty-publish") {
    openFilePicker();
  }
}

function onFilterInput(event) {
  if (event.target.id === "reports-search") {
    state.search = event.target.value || "";
    renderContent();
  }
  if (event.target.id === "reports-type") {
    state.type = event.target.value || "all";
    renderContent();
  }
}

function onDocumentClick(event) {
  if (event.target.id === "reports-publish-btn") {
    openFilePicker();
    return;
  }
  if (event.target.closest("[data-reports-dismiss]")) {
    if (!state.publishing) closeModal();
    return;
  }
  if (event.target.closest("[data-reports-delete-dismiss]")) {
    if (!state.deleting) closeDeleteModal();
    return;
  }
  if (event.target.id === "reports-delete-confirm" && state.deleteReportId) {
    void deleteReport(state.deleteReportId);
    return;
  }
  if (event.target.id === "reports-form" || event.target.closest("#reports-form")) {
    return;
  }
}

function onDocumentSubmit(event) {
  if (event.target.id === "reports-form") submitPublish(event);
}

function bindEvents() {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("submit", onDocumentSubmit);
  $("page-content")?.addEventListener("click", onContentClick);
  $("page-filters")?.addEventListener("input", onFilterInput);
  $("page-filters")?.addEventListener("change", onFilterInput);
}

function unbindEvents() {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("submit", onDocumentSubmit);
  $("page-content")?.removeEventListener("click", onContentClick);
  $("page-filters")?.removeEventListener("input", onFilterInput);
  $("page-filters")?.removeEventListener("change", onFilterInput);
}

function mountReports() {
  if (state.mounted) {
    loadReports();
    return;
  }
  state.mounted = true;
  renderToolbar();
  renderFilters();
  bindEvents();
  void loadReports();
}

function unmountReports() {
  if (!state.mounted) return;
  state.mounted = false;
  closeModal();
  closeDeleteModal();
  unbindEvents();
  state.loading = false;
  state.publishing = false;
  state.error = null;
  state.success = null;
  state.reports = [];
  state.search = "";
  state.type = "all";
  state.selectedFile = null;
  $("page-actions").innerHTML = "";
  $("page-filters").innerHTML = "";
  $("page-content").innerHTML = "";
}

export function bootReports() {
  if (eventsBound) return;
  eventsBound = true;
  onPageChange((page) => {
    if (page.id === "reports") mountReports();
    else if (state.mounted) unmountReports();
  });
  if (getCurrentPageId() === "reports") mountReports();
}

export {
  visibleReports,
  mountReports,
  unmountReports,
  validateReportFile,
  validateReportTitle,
  REPORTS_MAX_BYTES,
};
