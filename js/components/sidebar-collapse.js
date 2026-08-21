/**
 * Recolher/expandir sidebar desktop — estado persistido em localStorage.
 */
const STORAGE_KEY = "qv:sidebarCollapsed";

export { STORAGE_KEY as SIDEBAR_COLLAPSE_STORAGE_KEY };

export function readSidebarCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}

export function applySidebarCollapsed(collapsed, { persist = true } = {}) {
  document.body?.classList.toggle("sidebar-collapsed", collapsed);
  if (persist) writeSidebarCollapsed(collapsed);

  const button = document.getElementById("sidebar-collapse-toggle");
  if (!button) return;

  const label = collapsed ? "Mostrar menu lateral" : "Ocultar menu lateral";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");

  window.dispatchEvent(new Event("resize"));
}

export function toggleSidebarCollapsed() {
  const collapsed = !document.body.classList.contains("sidebar-collapsed");
  applySidebarCollapsed(collapsed);
  return collapsed;
}

export function initSidebarCollapse() {
  applySidebarCollapsed(readSidebarCollapsed(), { persist: false });

  const button = document.getElementById("sidebar-collapse-toggle");
  if (!button) return () => {};

  const onClick = () => {
    toggleSidebarCollapsed();
  };
  button.addEventListener("click", onClick);
  return () => button.removeEventListener("click", onClick);
}
