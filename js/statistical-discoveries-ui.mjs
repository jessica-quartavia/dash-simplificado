/**
 * Filtros de UI — seção "Principais descobertas" (sem alterar cálculos).
 */
export const PRINCIPAL_DISCOVERIES_PREVIEW = 4;

export function isRenewalDiscovery(item) {
  const token = String(item?.category || item?.section || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  return token === "renovacao" || token === "renovação" || token === "renewal";
}

export function rawDiscoveriesFromPayload(payload) {
  if (!payload) return [];
  if (payload.discoveries?.length) return payload.discoveries;
  return payload.simpleInsights || [];
}

export function filterPrincipalDiscoveries(items, { passMin = () => true } = {}) {
  return (items || []).filter((d) => passMin(d) && !isRenewalDiscovery(d));
}

export function visiblePrincipalDiscoveries(items, expanded = false) {
  const list = items || [];
  return expanded ? list : list.slice(0, PRINCIPAL_DISCOVERIES_PREVIEW);
}

export function shouldShowDiscoveriesToggle(items) {
  return (items || []).length > PRINCIPAL_DISCOVERIES_PREVIEW;
}
