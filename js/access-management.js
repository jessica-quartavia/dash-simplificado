import { onPageChange, getCurrentPageId } from "./navigation.js";
import { authenticatedFetch } from "./auth.mjs";
import { getCurrentAccess } from "./access-context.js";
import { ACCESS_GROUPS, buildAccessUserTags } from "../lib/access/access-policy.mjs";
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
};

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

function openModal(user) {
  state.modal = user
    ? { ...user, groups: [...(user.groupCodes || [])] }
    : { email: "", displayName: "", groups: [], isOwner: false, isActive: true };
  renderModal();
}

function closeModal() {
  state.modal = null;
  const root = document.getElementById("overlay-root");
  if (!root) return;
  root.innerHTML = "";
  root.setAttribute("aria-hidden", "true");
}

function renderModal() {
  const user = state.modal;
  const root = document.getElementById("overlay-root");
  if (!user || !root) return;
  const editing = Boolean(user.id || (user.email && state.users.some((item) => item.email === user.email)));
  const groupChecks = Object.values(ACCESS_GROUPS)
    .map((group) => {
      const checked = user.groups.includes(group.code) ? "checked" : "";
      return `<label class="am-check"><input type="checkbox" data-am-group="${group.code}" ${checked} /> ${escapeHtml(group.name)}</label>`;
    })
    .join("");
  root.setAttribute("aria-hidden", "false");
  root.innerHTML = `
    <div class="reports-modal-backdrop" data-am-dismiss></div>
    <div class="reports-modal" role="dialog" aria-modal="true" aria-labelledby="am-modal-title">
      <header class="reports-modal-head">
        <h2 id="am-modal-title">${editing ? "Editar acesso" : "Adicionar acesso"}</h2>
      </header>
      <form id="amForm" class="reports-form">
        <label class="reports-field">
          <span class="reports-field-label">Email *</span>
          <input type="email" id="amEmail" required value="${escapeHtml(user.email)}" ${editing ? "readonly" : ""} />
        </label>
        <label class="reports-field">
          <span class="reports-field-label">Nome</span>
          <input type="text" id="amName" value="${escapeHtml(user.displayName || "")}" />
        </label>
        <fieldset class="reports-field">
          <legend class="reports-field-label">Times / perfis</legend>
          <div class="am-multiselect">${groupChecks}</div>
        </fieldset>
        <label class="am-check"><input type="checkbox" id="amIsOwner" ${user.isOwner ? "checked" : ""} /> Owner</label>
        <label class="am-check"><input type="checkbox" id="amIsActive" ${user.isActive !== false ? "checked" : ""} /> Ativo</label>
        <p id="amFormError" class="reports-form-error" hidden></p>
        <div class="reports-form-actions">
          <button type="button" class="btn btn-secondary" data-am-dismiss>Cancelar</button>
          <button type="submit" class="btn btn-primary" ${state.saving ? "disabled" : ""}>${state.saving ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>`;
  root.querySelectorAll("[data-am-dismiss]").forEach((el) => el.addEventListener("click", closeModal));
  $("amForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveUser();
  });
}

async function saveUser() {
  const errorNode = $("amFormError");
  const groups = [...document.querySelectorAll("[data-am-group]:checked")].map((input) => input.dataset.amGroup);
  const payload = {
    email: $("amEmail")?.value || "",
    displayName: $("amName")?.value || "",
    groups,
    isOwner: Boolean($("amIsOwner")?.checked),
    isActive: Boolean($("amIsActive")?.checked),
  };
  state.saving = true;
  renderModal();
  try {
    const response = await authenticatedFetch("/api/analytics?action=access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (errorNode) {
        errorNode.hidden = false;
        errorNode.textContent = body.error || "Não foi possível salvar o acesso.";
      }
      state.saving = false;
      renderModal();
      return;
    }
    state.saving = false;
    closeModal();
    await loadUsers();
  } catch (error) {
    state.saving = false;
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = error instanceof Error ? error.message : "Não foi possível salvar o acesso.";
    }
    renderModal();
  }
}

async function loadUsers() {
  state.loading = true;
  state.error = null;
  renderPage();
  try {
    const response = await authenticatedFetch("/api/analytics?action=access&scope=users");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os acessos.");
    state.users = payload.users || [];
    state.summary = payload.summary || null;
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
