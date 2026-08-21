/**
 * Coordenação global: apenas um dropdown/popover aberto por vez.
 */
let openInstance = null;

export function registerOpenDropdown(instance) {
  if (!instance) return;
  if (openInstance && openInstance !== instance) {
    openInstance.close?.();
  }
  openInstance = instance;
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
