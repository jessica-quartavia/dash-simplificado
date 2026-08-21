import {
  DEFAULT_PAGE_ID,
  PAGE_GROUPS,
  getPageById,
  getPagesByGroup,
  isPageImplemented,
  resolvePageFromHash,
} from "./pages.js";
import { closeOpenDropdown } from "./components/dropdown-coordinator.js";
import { initSidebarCollapse } from "./components/sidebar-collapse.js";

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

export function navigateTo(pageId, { updateHash = true } = {}) {
  const page = getPageById(pageId) || getPageById(DEFAULT_PAGE_ID);
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

  closeMobileNav();
  closeOpenDropdown();
  for (const listener of pageChangeListeners) {
    try {
      listener(page);
    } catch (error) {
      console.error("[nav] page change listener", error);
    }
  }
  if (!isPageImplemented(page.id)) {
    renderUnimplementedPageShell();
  }
}

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  if (!nav) return;

  nav.replaceChildren();

  for (const group of PAGE_GROUPS) {
    const pages = getPagesByGroup(group.id);
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
      button.textContent = page.navLabel;
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
      if (!button) return;
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

  const initial = resolvePageFromHash(consumeIntendedHash());
  navigateTo(initial.id);
}
