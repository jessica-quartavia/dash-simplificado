/**
 * Lista completa de clientes em atenção — resolução de payload (cache legado / aliases).
 */

export function resolveAttentionClientsAll(payload) {
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.attentionClientsAll,
    payload.attentionClientRows,
    payload.attentionClients?.rows,
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) return list;
  }
  for (const list of candidates) {
    if (Array.isArray(list)) return list;
  }
  return [];
}

/** Total esperado para detectar payload incompleto (refetch). */
export function expectedAttentionClientsTotal(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const direct = payload.attentionClientsTotal;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const stalled = payload.summary?.stalledJourney;
  if (typeof stalled === "number" && Number.isFinite(stalled) && stalled > 0) return stalled;
  return resolveAttentionClientsAll(payload).length;
}
