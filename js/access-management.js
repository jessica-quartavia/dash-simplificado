import { onPageChange, getCurrentPageId } from "./navigation.js";
import { authenticatedFetch, getUserEmail } from "./auth.mjs";
import { getCurrentAccess } from "./access-context.js";
import { ACCESS_GROUPS, buildAccessUserTags, normalizeAccessEmail } from "../lib/access/access-policy.mjs";
import { escapeHtml } from "./general-charts.mjs";

const PAGE_ID = "access_management";

const state = {
  mounted: false,
  loading: false,
  error: null,
  users: [],
  summary: null,
  filters: { search: "", group: "all", owner: "all", status: "active" },
  modal: null,
  saving: false,
  deleting: false,
  formError: "",
};

function isDevHost() {
  return typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
}

function logAccessUi(label, extra = {}) {
  if (!isDevHost()) return;
  const safe = { ...extra };
  delete safe.token;
  delete safe.accessToken;
  delete safe.authorization;
  console.info(`[AccessManagement] ${label}`, safe);
}

let eventsBound = false;

function $(id) {
  return document.getElementById(id);
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function kpiCard(label, value) {
  return `<article class="kpi-card kpi-card-compact">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${escapeHtml(String(value ?? 0))}</div>
  </article>`;
}

function groupBadges(user) {
  return buildAccessUserTags(user)
    .map((tag) => `<span class="am-badge am-badge-${tag.kind}">${escapeHtml(tag.label)}</span>`)
    .join("");
}

function filteredUsers() {
  const search = state.filters.search.trim().toLowerCase();
  return state.users.filter((user) => {
    if (search) {
      const hay = `${user.displayName || ""} ${user.email || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (state.filters.group !== "all" && !(user.groupCodes || []).includes(state.filters.group)) return false;
    if (state.filters.owner === "yes" && !user.isOwner) return false;
    if (state.filters.owner === "no" && user.isOwner) return false;
    if (state.filters.status === "active" && !user.isActive) return false;
    if (state.filters.status === "inactive" && user.isActive) return false;
    return true;
  });
}

function renderFilters() {
  const host = $("page-filters");
  if (!host) return;
  host.innerHTML = `<div class="filter-bar am-filters">
    <label class="filter-search">Busca
      <input id="amSearch" type="search" placeholder="Nome ou e-mail" value="${escapeHtml(state.filters.search)}" />
    </label>
    <label>Time
      <select id="amGroup">
        <option value="all">Todos</option>
        ${Object.values(ACCESS_GROUPS)
          .map((group) => `<option value="${group.code}" ${state.filters.group === group.code ? "selected" : ""}>${escapeHtml(group.name)}</option>`)
          .join("")}
      </select>
    </label>
    <label>Owner
      <select id="amOwner">
        <option value="all" ${state.filters.owner === "all" ? "selected" : ""}>Todos</option>
        <option value="yes" ${state.filters.owner === "yes" ? "selected" : ""}>Sim</option>
        <option value="no" ${state.filters.owner === "no" ? "selected" : ""}>Não</option>
      </select>
    </label>
    <label>Status
      <select id="amStatus">
        <option value="active" ${state.filters.status === "active" ? "selected" : ""}>Ativo</option>
        <option value="inactive" ${state.filters.status === "inactive" ? "selected" : ""}>Desativado</option>
        <option value="all" ${state.filters.status === "all" ? "selected" : ""}>Todos</option>
      </select>
    </label>
  </div>`;
  const sync = () => {
    state.filters = {
      search: $("amSearch")?.value || "",
      group: $("amGroup")?.value || "all",
      owner: $("amOwner")?.value || "all",
      status: $("amStatus")?.value || "active",
    };
    renderTableOnly();
  };
  $("amSearch")?.addEventListener("input", sync);
  $("amGroup")?.addEventListener("change", sync);
  $("amOwner")?.addEventListener("change", sync);
  $("amStatus")?.addEventListener("change", sync);
}

function renderTableOnly() {
  const body = $("amTableBody");
  if (!body) return;
  const rows = filteredUsers();
  body.innerHTML = rows.length
    ? rows
        .map(
          (user) => `<tr>
      <td class="am-col-name" title="${escapeHtml(user.displayName || "")}">${escapeHtml(user.displayName || "—")}</td>
      <td class="am-col-email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</td>
      <td class="am-col-groups"><div class="am-tag-list">${groupBadges(user)}</div></td>
      <td class="am-col-owner">${user.isOwner ? "Sim" : "Não"}</td>
      <td class="am-col-status"><span class="am-status ${user.isActive ? "is-active" : "is-inactive"}">${user.isActive ? "Ativo" : "Desativado"}</span></td>
      <td class="am-col-updated">${escapeHtml(fmtDate(user.updatedAt))}</td>
      <td class="am-col-actions"><button type="button" class="btn btn-secondary am-edit-btn" data-am-edit="${escapeHtml(user.email)}">Editar</button></td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="placeholder-note">Nenhum usuário neste recorte.</td></tr>`;
  body.querySelectorAll("[data-am-edit]").forEach((button) => {
    button.addEventListener("click", () => openModal(state.users.find((user) => user.email === button.dataset.amEdit)));
  });
}

function renderPage() {
  const host = $("page-content");
  if (!host) return;
  if (!getCurrentAccess()?.isOwner) {
    host.innerHTML = `<p class="page-error">Somente Owners podem gerenciar acessos.</p>`;
    return;
  }
  if (state.loading) {
    host.innerHTML = `<p class="placeholder-note">Carregando acessos…</p>`;
    return;
  }
  if (state.error) {
    host.innerHTML = `<p class="page-error">${escapeHtml(state.error)}</p>
      <button type="button" class="btn btn-secondary" id="amRetry">Tentar novamente</button>`;
    $("amRetry")?.addEventListener("click", () => void loadUsers());
    return;
  }
  const summary = state.summary || {};
  host.innerHTML = `<div class="am-page">
    <section class="section-block">
      <h2>Resumo</h2>
      <div class="kpi-row kpi-row-compact am-kpi-row">
        ${kpiCard("Usuários ativos", summary.active)}
        ${kpiCard("Owners", summary.owners)}
        ${kpiCard("Líderes", summary.leaders)}
        ${kpiCard("EPs", summary.eps)}
        ${kpiCard("Team Leaders EP", summary.teamLeadersEp)}
        ${kpiCard("Qualidade", summary.quality)}
        ${kpiCard("Financeiro", summary.finance)}
        ${kpiCard("Desativados", summary.inactive)}
      </div>
    </section>
    <section class="table-panel am-table-panel">
      <div class="table-panel-head">
        <h2>Usuários</h2>
        <button type="button" class="btn btn-primary" id="amAdd">+ Adicionar acesso</button>
      </div>
      <div class="table-scroll">
        <table class="gd-table am-table">
          <colgroup>
            <col class="am-col-name" />
            <col class="am-col-email" />
            <col class="am-col-groups" />
            <col class="am-col-owner" />
            <col class="am-col-status" />
            <col class="am-col-updated" />
            <col class="am-col-actions" />
          </colgroup>
          <thead><tr>
            <th>Nome</th>
            <th>Email</th>
            <th>Times / Perfis</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Última alteração</th>
            <th class="am-col-actions">Ações</th>
          </tr></thead>
          <tbody id="amTableBody"></tbody>
        </table>
      </div>
    </section>
  </div>`;
  $("amAdd")?.addEventListener("click", () => openModal(null));
  renderTableOnly();
}

function isSelfUser(user) {
  return normalizeAccessEmail(user?.email) && normalizeAccessEmail(user.email) === normalizeAccessEmail(getUserEmail());
}

function openModal(user) {
  state.formError = "";
  state.saving = false;
  state.deleting = false;
  state.modal = user
    ? {
        id: user.id,
        email: user.email,
        displayName: user.displayName || "",
        groups: [...(user.groupCodes || [])],
        isOwner: Boolean(user.isOwner),
        isActive: user.isActive !== false,
        phase: "form",
      }
    : { email: "", displayName: "", groups: [], isOwner: false, isActive: true, phase: "form" };
  renderModal();
}

function closeModal() {
  state.modal = null;
  state.formError = "";
  state.saving = false;
  state.deleting = false;
  const root = document.getElementById("overlay-root");
  if (!root) return;
  root.innerHTML = "";
  root.setAttribute("aria-hidden", "true");
}

function collectForm() {
  return {
    email: $("amEmail")?.value || state.modal?.email || "",
    displayName: $("amName")?.value || "",
    groups: [...document.querySelectorAll("[data-am-group]:checked")].map((input) => input.dataset.amGroup),
    isOwner: Boolean($("amIsOwner")?.checked),
    isActive: Boolean($("amIsActive")?.checked),
  };
}

function showFormError(message) {
  state.formError = message || "Não foi possível salvar o acesso.";
  const errorNode = $("amFormError");
  if (!errorNode) return;
  errorNode.hidden = false;
  errorNode.textContent = state.formError;
}

function setModalBusy(kind) {
  state.saving = kind === "saving";
  state.deleting = kind === "deleting";
  const saveBtn = $("amSave");
  const deleteBtn = $("amDelete");
  const confirmBtn = $("amConfirmDelete");
  if (saveBtn) {
    saveBtn.disabled = Boolean(kind);
    saveBtn.textContent = kind === "saving" ? "Salvando…" : "Salvar";
  }
  if (deleteBtn) deleteBtn.disabled = Boolean(kind);
  if (confirmBtn) {
    confirmBtn.disabled = Boolean(kind);
    confirmBtn.textContent = kind === "deleting" ? "Excluindo…" : "Excluir acesso";
  }
  document.querySelectorAll("[data-am-dismiss]").forEach((el) => {
    if (el.tagName === "BUTTON") el.disabled = Boolean(kind);
  });
}

function renderModal() {
  const user = state.modal;
  const root = document.getElementById("overlay-root");
  if (!user || !root) return;
  const editing = Boolean(user.id);
  const selfEdit = editing && isSelfUser(user);
  const groupChecks = Object.values(ACCESS_GROUPS)
    .map((group) => {
      const checked = (user.groups || []).includes(group.code) ? "checked" : "";
      return `<label class="am-check"><input type="checkbox" data-am-group="${group.code}" ${checked} /> <span>${escapeHtml(group.name)}</span></label>`;
    })
    .join("");

  root.setAttribute("aria-hidden", "false");
  if (user.phase === "confirm-delete") {
    root.innerHTML = `
      <div class="am-modal-backdrop" data-am-dismiss></div>
      <div class="am-modal" role="dialog" aria-modal="true" aria-labelledby="am-modal-title">
        <header class="am-modal-head">
          <h2 id="am-modal-title">Excluir acesso</h2>
        </header>
        <p class="am-modal-lead">Tem certeza que deseja excluir o acesso de ${escapeHtml(user.email)}?</p>
        <p class="am-modal-note">Essa ação remove o cadastro de acesso e os vínculos de times desta pessoa.</p>
        <p id="amFormError" class="am-modal-error" ${state.formError ? "" : "hidden"}>${escapeHtml(state.formError)}</p>
        <div class="am-modal-actions">
          <button type="button" class="btn btn-secondary" data-am-back>Cancelar</button>
          <button type="button" class="btn btn-danger" id="amConfirmDelete">${state.deleting ? "Excluindo…" : "Excluir acesso"}</button>
        </div>
      </div>`;
    root.querySelector("[data-am-dismiss]")?.addEventListener("click", closeModal);
    root.querySelector("[data-am-back]")?.addEventListener("click", () => {
      state.modal.phase = "form";
      state.formError = "";
      renderModal();
    });
    $("amConfirmDelete")?.addEventListener("click", () => void deleteUser());
    return;
  }

  root.innerHTML = `
    <div class="am-modal-backdrop" data-am-dismiss></div>
    <div class="am-modal" role="dialog" aria-modal="true" aria-labelledby="am-modal-title">
      <header class="am-modal-head">
        <h2 id="am-modal-title">${editing ? "Editar acesso" : "Adicionar acesso"}</h2>
      </header>
      <form id="amForm" class="am-modal-form">
        <label class="am-field">
          <span class="am-field-label">Email *</span>
          <input type="email" id="amEmail" required value="${escapeHtml(user.email)}" ${editing ? "readonly" : ""} />
        </label>
        <label class="am-field">
          <span class="am-field-label">Nome</span>
          <input type="text" id="amName" value="${escapeHtml(user.displayName || "")}" />
        </label>
        <fieldset class="am-field am-fieldset">
          <legend class="am-field-label">Times / perfis</legend>
          <div class="am-check-list">${groupChecks}</div>
        </fieldset>
        <label class="am-check"><input type="checkbox" id="amIsOwner" ${user.isOwner ? "checked" : ""} ${selfEdit ? "disabled" : ""} /> <span>Owner</span></label>
        <label class="am-check"><input type="checkbox" id="amIsActive" ${user.isActive !== false ? "checked" : ""} ${selfEdit ? "disabled" : ""} /> <span>Ativo</span></label>
        ${selfEdit ? `<p class="am-modal-note">Outro Owner precisa alterar o seu próprio acesso.</p>` : ""}
        <p id="amFormError" class="am-modal-error" ${state.formError ? "" : "hidden"}>${escapeHtml(state.formError)}</p>
        <div class="am-modal-actions">
          ${editing && !selfEdit ? `<button type="button" class="btn btn-secondary am-delete-btn" id="amDelete">Excluir acesso</button>` : ""}
          <button type="button" class="btn btn-secondary" data-am-dismiss>Cancelar</button>
          <button type="submit" class="btn btn-primary" id="amSave" ${state.saving ? "disabled" : ""}>${state.saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>`;
  root.querySelectorAll("[data-am-dismiss]").forEach((el) => el.addEventListener("click", closeModal));
  $("amDelete")?.addEventListener("click", () => {
    Object.assign(state.modal, collectForm());
    state.modal.phase = "confirm-delete";
    state.formError = "";
    renderModal();
  });
  $("amForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    logAccessUi("form submit");
    void saveUser();
  });
}

async function saveUser() {
  const form = collectForm();
  if (state.modal) Object.assign(state.modal, form);
  const editing = Boolean(state.modal?.id);
  const payload = { ...form, mode: editing ? "update" : "create" };
  logAccessUi("payload email=", { email: normalizeAccessEmail(payload.email) });
  logAccessUi("groups=", { count: payload.groups.length, groups: payload.groups });
  logAccessUi("owner=", { owner: payload.isOwner, active: payload.isActive, mode: payload.mode });
  setModalBusy("saving");
  logAccessUi("request start", { action: payload.mode, endpoint: "/api/analytics?action=access", method: "POST" });
  try {
    const response = await authenticatedFetch("/api/analytics?action=access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    logAccessUi("response status=", { status: response.status, code: body.code || null });
    if (!response.ok) {
      logAccessUi("response error=", { error: body.error || null, code: body.code || null });
      setModalBusy(false);
      showFormError(body.error || "Não foi possível salvar o acesso.");
      return;
    }
    closeModal();
    logAccessUi("refresh list");
    await loadUsers({ silent: true });
  } catch (error) {
    setModalBusy(false);
    const message = error instanceof Error ? error.message : "Não foi possível salvar o acesso.";
    logAccessUi("response error=", { error: message });
    showFormError(message);
  }
}

async function deleteUser() {
  const email = state.modal?.email || "";
  setModalBusy("deleting");
  logAccessUi("request start", { action: "delete", endpoint: "/api/analytics?action=access", method: "DELETE" });
  try {
    const response = await authenticatedFetch("/api/analytics?action=access", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await response.json().catch(() => ({}));
    logAccessUi("response status=", { status: response.status, code: body.code || null });
    if (!response.ok) {
      logAccessUi("response error=", { error: body.error || null });
      setModalBusy(false);
      showFormError(body.error || "Não foi possível excluir o acesso.");
      return;
    }
    closeModal();
    logAccessUi("refresh list");
    await loadUsers({ silent: true });
  } catch (error) {
    setModalBusy(false);
    showFormError(error instanceof Error ? error.message : "Não foi possível excluir o acesso.");
  }
}

async function loadUsers({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    state.error = null;
    renderPage();
  }
  try {
    const response = await authenticatedFetch("/api/analytics?action=access&scope=users");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os acessos.");
    state.users = payload.users || [];
    state.summary = payload.summary || null;
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Não foi possível carregar os acessos.";
  } finally {
    state.loading = false;
    renderFilters();
    renderPage();
  }
}

function mount() {
  state.mounted = true;
  renderFilters();
  renderPage();
  if (!state.users.length && !state.loading) void loadUsers();
}

function unmount() {
  state.mounted = false;
  closeModal();
}

export function bootAccessManagement() {
  if (!eventsBound) {
    eventsBound = true;
    onPageChange((page) => {
      if (page.id === PAGE_ID) mount();
      else if (state.mounted) unmount();
    });
  }
  if (getCurrentPageId() === PAGE_ID) mount();
}
