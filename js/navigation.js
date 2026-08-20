import {
  DEFAULT_PAGE_ID,
  PAGE_GROUPS,
  getPageById,
  getPagesByGroup,
  isPageImplemented,
  resolvePageFromHash,
} from "./pages.js";

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
    section.setAttribute("aria-labelledby", `nav-group-${group.id}`);

    const heading = document.createElement("h2");
    heading.className = "nav-group-label";
    heading.id = `nav-group-${group.id}`;
    heading.textContent = group.label;

    const list = document.createElement("ul");
    list.className = "nav-list";

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

    section.append(heading, list);
    nav.appendChild(section);
  }
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

  if (!navBound) {
    navBound = true;

    document.getElementById("sidebar-nav")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page-nav]");
      if (!button) return;
      navigateTo(button.dataset.pageNav);
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
