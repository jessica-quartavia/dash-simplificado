/**
 * Shell da barra de filtros: checkbox sticky + persistência por página.
 */
import { escapeHtml } from "../../general-charts.mjs";

const STORAGE_PREFIX = "qv:filter-sticky:";
const memorySticky = new Map();

export function readStickyPinned(pageId) {
  if (!pageId) return false;
  try {
    const stored = sessionStorage.getItem(`${STORAGE_PREFIX}${pageId}`);
    if (stored != null) return stored === "1";
  } catch {
    /* ignore */
  }
  return memorySticky.get(pageId) === true;
}

export function writeStickyPinned(pageId, pinned) {
  if (!pageId) return;
  memorySticky.set(pageId, Boolean(pinned));
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${pageId}`, pinned ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function renderFilterShell({ pageId, stickyPinned = false, innerHtml = "" } = {}) {
  return `
    <div class="filter-shell" data-filter-shell data-page-id="${escapeHtml(pageId || "")}">
      <div class="filter-shell-toolbar">
        <label class="filter-sticky-toggle">
          <input type="checkbox" data-filter-sticky ${stickyPinned ? "checked" : ""} />
          <span>Fixar filtros ao rolar</span>
        </label>
      </div>
      <div class="filter-shell-body" data-filter-body>
        ${innerHtml}
      </div>
    </div>`;
}

/** O scroll principal do portal ocorre em document/window (sem overflow em .portal-main). */
export function resolveFilterScrollTarget() {
  if (typeof document === "undefined") return null;
  const portalMain = document.querySelector(".portal-main");
  if (portalMain) {
    const style = getComputedStyle(portalMain);
    const scrolls =
      /auto|scroll/.test(style.overflowY)
      || /auto|scroll/.test(style.overflow);
    if (scrolls && portalMain.scrollHeight > portalMain.clientHeight) return portalMain;
  }
  return typeof window !== "undefined" ? window : null;
}

export function bindFilterShell(host, pageId) {
  if (!host || !pageId) return () => {};
  const shell = host.querySelector("[data-filter-shell]");
  const checkbox = host.querySelector("[data-filter-sticky]");
  const scrollTarget = resolveFilterScrollTarget();
  const cleanups = [];

  const syncPinnedClasses = (pinned) => {
    host.classList.toggle("is-sticky-pinned", pinned);
    shell?.classList.toggle("is-sticky-pinned", pinned);
    if (!pinned) host.classList.remove("is-stuck");
  };

  const syncStuck = () => {
    if (!host.classList.contains("is-sticky-pinned")) {
      host.classList.remove("is-stuck");
      return;
    }
    const top = host.getBoundingClientRect().top;
    host.classList.toggle("is-stuck", top <= 0.5);
  };

  const onStickyChange = () => {
    const pinned = Boolean(checkbox?.checked);
    writeStickyPinned(pageId, pinned);
    syncPinnedClasses(pinned);
    syncStuck();
  };

  const initialPinned = readStickyPinned(pageId);
  if (checkbox) checkbox.checked = initialPinned;
  syncPinnedClasses(initialPinned);

  checkbox?.addEventListener("change", onStickyChange);
  cleanups.push(() => checkbox?.removeEventListener("change", onStickyChange));

  if (scrollTarget) {
    scrollTarget.addEventListener("scroll", syncStuck, { passive: true });
    cleanups.push(() => scrollTarget.removeEventListener("scroll", syncStuck));
  }
  syncStuck();

  return () => cleanups.forEach((fn) => fn());
}

/**
 * Monta shell + executa bind do conteúdo dentro de [data-filter-body].
 */
export function mountPageFilters({ host, pageId, innerHtml, onBodyReady } = {}) {
  if (!host || !pageId) return () => {};
  const stickyPinned = readStickyPinned(pageId);
  host.classList.toggle("is-sticky-pinned", stickyPinned);
  host.innerHTML = renderFilterShell({ pageId, stickyPinned, innerHtml });
  const body = host.querySelector("[data-filter-body]");
  const unbindShell = bindFilterShell(host, pageId);
  const unbindBody = onBodyReady?.(body) || (() => {});
  return () => {
    host.classList.remove("is-sticky-pinned", "is-stuck");
    unbindBody();
    unbindShell();
  };
}
