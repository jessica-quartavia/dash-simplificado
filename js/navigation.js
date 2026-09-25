import {
  DEFAULT_PAGE_ID,
  getPageById,
  isPageImplemented,
  resolvePageFromHash,
} from "./pages.js";
import { closeOpenDropdown } from "./components/dropdown-coordinator.js";
import { initSidebarCollapse } from "./components/sidebar-collapse.js";
import { resetPageFetchContext, isForegroundBusy } from "./utils/page-load.js";
import {
  ACCESS_LEGACY_OWNER_MESSAGE,
  canCurrentUserAccessPage,
  getHomePageId,
  getMenuGroups,
  getPageAccessMetadata,
} from "./access-context.js";

const INTENDED_HASH_KEY = "qv:intendedHash";

const PLACEHOLDER_FILTERS =
  '<p class="placeholder-note">Os filtros desta página serão migrados na próxima etapa.</p>';
const PLACEHOLDER_CONTENT =
  '<p class="placeholder-note">O conteúdo desta página será migrado posteriormente, sem dados simulados.</p>';

function renderUnimplementedPageShell() {
  const filters = document.getElementById("page-filters");
  const content = document.getElementById("page-content");
  const actions = document.getElementById("page-actions");
  if (filters) filters.innerHTML = PLACEHOLDER_FILTERS;
  if (content) content.innerHTML = PLACEHOLDER_CONTENT;
  if (actions) actions.innerHTML = "";
}

let currentPageId = DEFAULT_PAGE_ID;
let pageGeneration = 0;
let navBound = false;
const pageChangeListeners = [];
/** @type {Set<string>} categorias abertas na sessão SPA */
const openNavGroups = new Set();

export function onPageChange(fn) {
  if (typeof fn === "function") pageChangeListeners.push(fn);
}

function consumeIntendedHash() {
  try {
    const stored = sessionStorage.getItem(INTENDED_HASH_KEY);
    if (stored) sessionStorage.removeItem(INTENDED_HASH_KEY);
    if (stored && stored.replace(/^#/, "").trim()) return stored;
  } catch {
    /* ignore */
  }
  return window.location.hash;
}

export function getCurrentPageId() {
  return currentPageId;
}

export function getPageGeneration() {
  return pageGeneration;
}

function clearPageShell() {
  const filters = document.getElementById("page-filters");
  const content = document.getElementById("page-content");
  const actions = document.getElementById("page-actions");
  if (filters) {
    filters.replaceChildren();
    filters.classList.remove("metric-doc-search-panel");
  }
  if (actions) actions.replaceChildren();
  if (content) {
    content.innerHTML =
      '<div class="gd-status" role="status"><strong>Carregando…</strong><span>Preparando a página selecionada.</span></div>';
  }
}

export function getCurrentPageCanonical() {
  return currentPageId;
}

function pageHeading(page) {
  const suffix = String(page?.titleSuffix || "").trim();
  return suffix ? `${page.title} ${suffix}` : page.title;
}

function setDocumentTitle(page) {
  document.title = `${pageHeading(page)} · Analytics QuartaVia`;
}

function updatePageChrome(page) {
  const eyebrow = document.getElementById("page-eyebrow");
  const title = document.getElementById("page-title");
  const description = document.getElementById("page-description");
  const notice = document.getElementById("page-construction-notice");
  const view = document.getElementById("page-view");

  if (eyebrow) eyebrow.textContent = page.eyebrow;
  if (title) {
    title.replaceChildren();
    title.append(page.title);
    const suffix = String(page.titleSuffix || "").trim();
    if (suffix) {
      const mark = document.createElement("span");
      mark.className = "page-title-suffix";
      mark.textContent = suffix;
      title.append(" ", mark);
    }
  }
  if (description) description.textContent = page.description;
  if (notice) {
    const text = String(page.constructionNotice || "").trim();
    notice.textContent = text;
    notice.hidden = !text;
  }
  if (view) view.dataset.page = page.id;

  document.querySelectorAll("[data-page-nav]").forEach((button) => {
    const active = button.dataset.pageNav === page.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  syncNavGroupForPage(page);
}

function syncNavGroupForPage(page) {
  if (!page?.group) return;
  openNavGroups.add(page.group);
  document.querySelectorAll(".nav-group[data-group-id]").forEach((section) => {
    const groupId = section.dataset.groupId;
    const expanded = openNavGroups.has(groupId);
    section.classList.toggle("is-open", expanded);
    const toggle = section.querySelector(".nav-group-toggle");
    const list = section.querySelector(".nav-list");
    if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (list) list.hidden = !expanded;
  });
}

function toggleNavGroup(groupId) {
  if (openNavGroups.has(groupId)) openNavGroups.delete(groupId);
  else openNavGroups.add(groupId);
  const section = document.querySelector(`.nav-group[data-group-id="${groupId}"]`);
  if (!section) return;
  const expanded = openNavGroups.has(groupId);
  section.classList.toggle("is-open", expanded);
  const toggle = section.querySelector(".nav-group-toggle");
  const list = section.querySelector(".nav-list");
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  if (list) list.hidden = !expanded;
}

function renderForbiddenPage(message = "Você não possui permissão para acessar esta área.") {
  const filters = document.getElementById("page-filters");
  const content = document.getElementById("page-content");
  const actions = document.getElementById("page-actions");
  if (filters) filters.innerHTML = "";
  if (actions) actions.innerHTML = "";
  if (content) {
    content.innerHTML = `<div class="gd-status" role="status">
      <strong>Acesso negado</strong>
      <span>${message}</span>
    </div>`;
  }
}

function renderPageBootError(page, error) {
  const filters = document.getElementById("page-filters");
  const content = document.getElementById("page-content");
  const actions = document.getElementById("page-actions");
  if (actions) actions.innerHTML = "";
  if (filters && !filters.innerHTML.trim()) {
    filters.innerHTML = `<p class="placeholder-note">Os filtros desta página ficam disponíveis após o carregamento.</p>`;
  }
  if (!content) return;
  const isSatisfaction = page?.id === "satisfaction";
  const isInternalMech = page?.id === "internal_mechanisms_satisfaction";
  const title = isSatisfaction
    ? "Não foi possível carregar a Pesquisa de Satisfação."
    : isInternalMech
      ? "Não foi possível carregar Mecanismos × Satisfação."
      : "Não foi possível carregar esta página.";
  const detail = error instanceof Error && error.message
    ? error.message
    : "A página não inicializou. Tente novamente.";
  content.innerHTML = `<div class="gd-status">
    <strong>${title}</strong>
    <span>${detail}</span>
    <div style="margin-top:12px"><button class="btn btn-secondary" type="button" id="page-boot-retry">Tentar novamente</button></div>
  </div>`;
  document.getElementById("page-boot-retry")?.addEventListener("click", () => {
    navigateTo(page.id, { updateHash: false });
  });
}

const PAGE_BOOT_RECOVER = {
  satisfaction: () => import("./satisfaction.js").then((mod) => mod.bootSatisfaction()),
  internal_mechanisms_satisfaction: () =>
    import("./internal-mechanisms-satisfaction.js").then((mod) => mod.bootInternalMechanismsSatisfaction()),
  internal_mechanisms_renewal_projection: () =>
    import("./internal-mechanisms-renewal-projection.js").then((mod) => mod.bootInternalMechanismsRenewalProjection()),
};

function isStillPreparing() {
  const content = document.getElementById("page-content");
  return Boolean(content?.textContent?.includes("Preparando a página selecionada."));
}

async function recoverPageBoot(page) {
  const recover = PAGE_BOOT_RECOVER[page.id];
  if (!recover) {
    renderPageBootError(page);
    return;
  }
  try {
    await recover();
    if (isStillPreparing()) {
      renderPageBootError(page, new Error("O módulo da página carregou, mas não substituiu o estado inicial."));
    }
  } catch (error) {
    console.error("[nav] page boot recover", error);
    renderPageBootError(page, error);
  }
}

function applyPageLocation(page, { updateHash = true } = {}) {
  currentPageId = page.id;
  window.__portalCurrentPage = page.hash;
  window.__portalCurrentPageCanonical = page.id;
  updatePageChrome(page);
  setDocumentTitle(page);
  if (updateHash) {
    const nextHash = `#${page.hash}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState({ page: page.id }, "", nextHash);
    }
  }
}

export function navigateTo(pageId, { updateHash = true } = {}) {
  let page = getPageById(pageId) || getPageById(DEFAULT_PAGE_ID);
  if (page && !canCurrentUserAccessPage(page.id)) {
    const meta = getPageAccessMetadata(page.id);
    if (meta.legacy && meta.ownerOnly) {
      pageGeneration += 1;
      resetPageFetchContext();
      applyPageLocation(page, { updateHash });
      renderForbiddenPage(ACCESS_LEGACY_OWNER_MESSAGE);
      closeMobileNav();
      closeOpenDropdown();
      return;
    }
    const fallbackId = getHomePageId() || DEFAULT_PAGE_ID;
    page = getPageById(fallbackId) || page;
    if (!canCurrentUserAccessPage(page.id)) {
      pageGeneration += 1;
      resetPageFetchContext();
      clearPageShell();
      renderForbiddenPage();
      return;
    }
  }
  pageGeneration += 1;
  resetPageFetchContext();
  clearPageShell();
  applyPageLocation(page, { updateHash });

  closeMobileNav();
  closeOpenDropdown();
  for (const listener of pageChangeListeners) {
    try {
      listener(page);
    } catch (error) {
      console.error("[nav] page change listener", error);
    }
  }
  if (isPageImplemented(page.id) && isStillPreparing()) {
    void recoverPageBoot(page);
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("page:navigate", { detail: { pageId: page.id } }));
    queueMicrotask(() => {
      if (!isForegroundBusy()) {
        document.dispatchEvent(new CustomEvent("page:ready", { detail: { pageId: page.id, cached: true } }));
      }
    });
  }
  if (!isPageImplemented(page.id)) {
    renderUnimplementedPageShell();
  }
}

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  if (!nav) return;

  nav.replaceChildren();

  const menuGroups = getMenuGroups();
  for (const group of menuGroups.length ? menuGroups : []) {
    const pages = group.pages || [];
    if (!pages.length) continue;

    const section = document.createElement("section");
    section.className = "nav-group";
    section.dataset.groupId = group.id;
    section.setAttribute("aria-labelledby", `nav-group-${group.id}`);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-group-toggle";
    toggle.id = `nav-group-${group.id}`;
    toggle.setAttribute("aria-controls", `nav-list-${group.id}`);
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span class="nav-group-chevron" aria-hidden="true"></span><span class="nav-group-text">${group.label}</span>`;

    const list = document.createElement("ul");
    list.className = "nav-list";
    list.id = `nav-list-${group.id}`;
    list.hidden = true;

    for (const page of pages) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.dataset.pageNav = page.id;
      const label = document.createElement("span");
      label.className = "nav-item-label";
      if (page.icon === "book-open") {
        const icon = document.createElement("span");
        icon.className = "nav-item-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M2.75 4.75A2.75 2.75 0 0 1 5.5 2h5.75v17.25H5.5a2.75 2.75 0 0 0-2.75 2.75V4.75Zm18.5 0A2.75 2.75 0 0 0 18.5 2h-5.75v17.25h5.75A2.75 2.75 0 0 1 21.25 22V4.75Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
        const text = document.createElement("span");
        text.textContent = page.navLabel;
        label.append(icon, text);
      } else {
        label.textContent = page.navLabel;
      }
      button.append(label);
      if (page.menuBadge?.label) {
        const badge = document.createElement("span");
        badge.className = `nav-badge nav-badge-${page.menuBadge.kind || "meta"}`;
        badge.textContent = page.menuBadge.label;
        button.append(badge);
      }
      if (page.disabled) {
        button.classList.add("is-disabled");
        if (page.menuBadge?.kind === "legacy") button.classList.add("is-legacy");
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      } else if (page.menuBadge?.kind === "legacy") {
        button.classList.add("is-legacy");
      }
      button.setAttribute("aria-current", "false");
      item.appendChild(button);
      list.appendChild(item);
    }

    section.append(toggle, list);
    nav.appendChild(section);
  }

  syncNavGroupForPage(getPageById(currentPageId));
}

function closeMobileNav() {
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function toggleMobileNav() {
  const open = document.body.classList.toggle("nav-open");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

export function bootNavigation() {
  renderSidebar();
  initSidebarCollapse();

  if (!navBound) {
    navBound = true;

    document.getElementById("sidebar-nav")?.addEventListener("click", (event) => {
      const groupToggle = event.target.closest(".nav-group-toggle");
      if (groupToggle) {
        const section = groupToggle.closest(".nav-group");
        if (section?.dataset.groupId) toggleNavGroup(section.dataset.groupId);
        return;
      }
      const button = event.target.closest("[data-page-nav]");
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
      navigateTo(button.dataset.pageNav);
    });

    document.getElementById("sidebar-nav")?.addEventListener("keydown", (event) => {
      const groupToggle = event.target.closest(".nav-group-toggle");
      if (!groupToggle) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const section = groupToggle.closest(".nav-group");
        if (section?.dataset.groupId) toggleNavGroup(section.dataset.groupId);
      }
    });

    document.getElementById("nav-toggle")?.addEventListener("click", () => {
      toggleMobileNav();
    });

    document.getElementById("nav-backdrop")?.addEventListener("click", () => {
      closeMobileNav();
    });

    window.addEventListener("hashchange", () => {
      const page = resolvePageFromHash(window.location.hash);
      navigateTo(page.id, { updateHash: false });
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMobileNav();
    });
  }

  const intended = resolvePageFromHash(consumeIntendedHash());
  const startId = canCurrentUserAccessPage(intended.id) ? intended.id : getHomePageId() || intended.id;
  navigateTo(startId);
}
