/**
 * Coordenação global: apenas um dropdown/popover aberto por vez + click-outside único.
 */
let openInstance = null;
let globalBound = false;

function onGlobalPointerDown(event) {
  if (!openInstance) return;
  if (typeof openInstance.containsEvent === "function" && openInstance.containsEvent(event)) return;
  openInstance.close?.();
}

function onGlobalKeyDown(event) {
  if (event.key !== "Escape" || !openInstance) return;
  event.preventDefault();
  event.stopPropagation();
  openInstance.close?.({ focusTrigger: true });
}

function ensureGlobalListener() {
  if (globalBound || typeof document === "undefined") return;
  document.addEventListener("pointerdown", onGlobalPointerDown, true);
  document.addEventListener("keydown", onGlobalKeyDown, true);
  globalBound = true;
}

export function registerOpenDropdown(instance) {
  if (!instance) return;
  if (openInstance && openInstance !== instance) {
    openInstance.close?.();
  }
  openInstance = instance;
  ensureGlobalListener();
}

export function unregisterOpenDropdown(instance) {
  if (openInstance === instance) openInstance = null;
}

export function closeOpenDropdown() {
  const current = openInstance;
  if (!current) return;
  openInstance = null;
  current.close?.();
}

export function getOpenDropdown() {
  return openInstance;
}

/** Para testes — simula clique fora sem DOM completo. */
export function shouldCloseDropdownForEvent(instance, event, nodes = []) {
  if (!instance) return false;
  if (typeof instance.containsEvent === "function") {
    return !instance.containsEvent(event);
  }
  const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
  if (path.length) return !nodes.some((node) => node && path.includes(node));
  const target = event?.target;
  return !nodes.some((node) => node && (node === target || node.contains?.(target)));
}
