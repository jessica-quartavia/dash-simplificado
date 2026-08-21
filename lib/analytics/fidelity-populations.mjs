/**
 * Extração de populações (sets de client_id) para fidelidade V1 × V2.
 * Sem PII — apenas IDs técnicos e campos de diagnóstico.
 */
import {
  auditPharusClientCrosswalk,
  buildPharusClientCrosswalk,
} from "./pharus-client-crosswalk.mjs";

export const V1_SCREENSHOT_REFERENCE = Object.freeze({
  mechanism_clients: 477,
  cancellation_effective: 498,
  cancellation_intent_request: 187,
  cancellation_in_process: 114,
  non_renewals: 353,
  early_cancellation: 119,
});

export const METRIC_IDS = [
  "mechanism_clients",
  "cancellation_effective",
  "cancellation_intent_request",
  "cancellation_in_process",
  "non_renewals",
  "early_cancellation",
];

function asSet(values) {
  return new Set((values || []).map((v) => String(v)).filter(Boolean));
}

export function setDiff(a, b) {
  const onlyA = [];
  const onlyB = [];
  const intersection = [];
  for (const id of a) {
    if (b.has(id)) intersection.push(id);
    else onlyA.push(id);
  }
  for (const id of b) {
    if (!a.has(id)) onlyB.push(id);
  }
  onlyA.sort();
  onlyB.sort();
  intersection.sort();
  return { onlyA, onlyB, intersection };
}

export function compareSets(v1Set, v2Set) {
  const a = asSet([...v1Set]);
  const b = asSet([...v2Set]);
  const { onlyA, onlyB, intersection } = setDiff(a, b);
  return {
    v1_count: a.size,
    v2_count: b.size,
    intersection_count: intersection.length,
    only_v1_count: onlyA.length,
    only_v2_count: onlyB.length,
    only_v1: onlyA,
    only_v2: onlyB,
    intersection,
  };
}

export function applyCancellationScope(rows, scope = "v1_ui_default") {
  const list = Array.isArray(rows) ? rows : [];
  if (scope === "payload_all") return list;
  if (scope === "v1_ui_default" || scope === "v2_ui_default") {
    return list.filter((row) => !row.isArchived);
  }
  return list;
}

export function buildMechanismConsolidatedSet({
  crosswalk,
  qvClientIdsWithMechanisms = new Set(),
  pharusUserIdsWithMechanisms = new Set(),
} = {}) {
  const consolidated = new Set();
  const matchedQvIds = new Set();
  for (const uid of pharusUserIdsWithMechanisms) {
    const userId = String(uid);
    if (crosswalk.ambiguousUserIds.has(userId)) continue;
    const qvId = crosswalk.byUserId.get(userId);
    if (qvId) {
      matchedQvIds.add(String(qvId));
      consolidated.add(String(qvId));
    } else {
      consolidated.add(`pharus:${userId}`);
    }
  }
  for (const qvId of qvClientIdsWithMechanisms) {
    if (!matchedQvIds.has(String(qvId))) consolidated.add(String(qvId));
  }
  return consolidated;
}

export function mechanismPopulationFromPayload(payload) {
  const quality = payload?.metadata?.consolidationQuality?.clients || {};
  const crosswalk = payload?.metadata?.consolidationQuality?.crosswalk || null;
  if (crosswalk) {
    const qvIds = new Set(
      (payload?.clients || [])
        .filter((c) => String(c.clientId || "").startsWith("pharus:") === false)
        .map((c) => String(c.clientId)),
    );
    const pharusIds = new Set();
    for (const row of payload?.clients || []) {
      const id = String(row.clientId || "");
      if (id.startsWith("pharus:")) pharusIds.add(id.replace(/^pharus:/, ""));
    }
    return buildMechanismConsolidatedSet({
      crosswalk,
      qvClientIdsWithMechanisms: qvIds,
      pharusUserIdsWithMechanisms: pharusIds,
    });
  }
  return asSet((payload?.clients || []).map((c) => c.clientId || c.client_id));
}

export function mechanismPopulationFromParts({
  clientsRaw = [],
  baseClients = [],
  pharusRows = [],
} = {}) {
  const qvClientIdsWithMechanisms = new Set(baseClients.map((c) => String(c.clientId)));
  const pharusUserIds = new Set(
    pharusRows.map((r) => String(r.userId || r.user_id || "")).filter(Boolean),
  );
  const profiles = new Map();
  for (const row of pharusRows) {
    const uid = String(row.userId || row.user_id || "");
    if (!uid) continue;
    profiles.set(uid, {
      name: row.userName || row.name || null,
      email: row.userEmail || row.email || null,
      cpf: row.cpf || null,
      phone: row.phone || null,
    });
  }
  const crosswalk = buildPharusClientCrosswalk(clientsRaw, profiles);
  return buildMechanismConsolidatedSet({
    crosswalk,
    qvClientIdsWithMechanisms,
    pharusUserIdsWithMechanisms: pharusUserIds,
  });
}

export function extractCancellationEffectiveSet(rows, scope = "v1_ui_default") {
  return asSet(
    applyCancellationScope(rows, scope)
      .filter((r) => r.hasEfetivado)
      .map((r) => r.clientId),
  );
}

export function extractCancellationIntentSet(rows, scope = "v1_ui_default") {
  return asSet(
    applyCancellationScope(rows, scope)
      .filter((r) => r.hasIntentionOrPedido)
      .map((r) => r.clientId),
  );
}

export function extractCancellationInProcessSet(rows, scope = "v1_ui_default") {
  return asSet(
    applyCancellationScope(rows, scope)
      .filter((r) => r.inProcessCurrently)
      .map((r) => r.clientId),
  );
}

export function extractComparableCycleRows(rows, scope = "v1_ui_default") {
  const byClient = new Map();
  for (const client of applyCancellationScope(rows, scope)) {
    if (!client.hasEfetivado || !client.cancellationDate || !client.cycleEndDate) continue;
    if (
      client.cancellationTiming !== "Não renovação"
      && client.cancellationTiming !== "Antes do fim do ciclo"
    ) continue;
    byClient.set(String(client.clientId), client);
  }
  return [...byClient.values()];
}

export function extractNonRenewalsSet(rows, scope = "v1_ui_default") {
  return asSet(
    extractComparableCycleRows(rows, scope)
      .filter((r) => r.cancellationTiming === "Não renovação")
      .map((r) => r.clientId),
  );
}

export function extractEarlyCancellationSet(rows, scope = "v1_ui_default") {
  return asSet(
    extractComparableCycleRows(rows, scope)
      .filter((r) => r.cancellationTiming === "Antes do fim do ciclo")
      .map((r) => r.clientId),
  );
}

const EXTRACTORS = {
  mechanism_clients: {
    fromMechanismsPayload: (payload) => mechanismPopulationFromPayload(payload),
    fromCancellationPayload: null,
  },
  cancellation_effective: {
    fromCancellationPayload: (payload, scope) =>
      extractCancellationEffectiveSet(payload?.clients || payload?.rows || [], scope),
  },
  cancellation_intent_request: {
    fromCancellationPayload: (payload, scope) =>
      extractCancellationIntentSet(payload?.clients || payload?.rows || [], scope),
  },
  cancellation_in_process: {
    fromCancellationPayload: (payload, scope) =>
      extractCancellationInProcessSet(payload?.clients || payload?.rows || [], scope),
  },
  non_renewals: {
    fromCancellationPayload: (payload, scope) =>
      extractNonRenewalsSet(payload?.clients || payload?.rows || [], scope),
  },
  early_cancellation: {
    fromCancellationPayload: (payload, scope) =>
      extractEarlyCancellationSet(payload?.clients || payload?.rows || [], scope),
  },
};

export function extractPopulationSet(metric, { mechanismsPayload = null, cancellationsPayload = null, scope = "v1_ui_default" } = {}) {
  const spec = EXTRACTORS[metric];
  if (!spec) throw new Error(`Métrica desconhecida: ${metric}`);
  if (metric === "mechanism_clients") {
    return spec.fromMechanismsPayload(mechanismsPayload);
  }
  return spec.fromCancellationPayload(cancellationsPayload, scope);
}

export function sampleRowsForDiagnosis(rows, idField = "clientId", limit = 12) {
  return (rows || []).slice(0, limit).map((row) => ({
    client_id: String(row[idField] || row.client_id || ""),
    hasEfetivado: row.hasEfetivado ?? null,
    hasIntentionOrPedido: row.hasIntentionOrPedido ?? null,
    inProcessCurrently: row.inProcessCurrently ?? null,
    isArchived: row.isArchived ?? null,
    cancellationTiming: row.cancellationTiming ?? null,
    cancellationDate: row.cancellationDate ?? null,
    cycleEndDate: row.cycleEndDate ?? null,
    churnEfetivadoAt: row.churnEfetivadoAt ?? null,
    distratoAssinadoAt: row.distratoAssinadoAt ?? null,
    distratoText: row.distratoText ?? null,
    dataChurnAt: row.dataChurnAt ?? null,
    processStatusName: row.processStatusName ?? null,
    sourcesMatched: row.sourcesMatched ?? null,
  }));
}

export function buildMechanismAuditSummary(payload) {
  const clients = payload?.metadata?.consolidationQuality?.clients || {};
  return {
    base_qv_total_clients_with_mechanisms: clients.qvClientsWithMechanisms ?? clients.baseQvOnly ?? null,
    pharus_total_users_with_mechanisms: clients.pharusUsersWithMechanisms ?? null,
    matchedInBoth: clients.matchedInBoth ?? null,
    baseQvOnly: clients.baseQvOnly ?? clients.qvOnly ?? null,
    unmatchedAppPharus: clients.unmatchedAppPharus ?? clients.pharusOnly ?? null,
    ambiguous: clients.ambiguous ?? clients.ambiguousMatches ?? null,
    consolidatedUniquePeople: clients.consolidatedUniquePeople ?? clients.consolidated ?? null,
    consolidationMode: clients.consolidationMode ?? null,
    formulaValidated: clients.formulaValidated ?? null,
    pharusConsulted: payload?.metadata?.pharusConsulted ?? null,
    pharusNote: payload?.metadata?.pharusNote ?? null,
  };
}

export function auditMatchMethods(crosswalk, pharusUserIds = []) {
  const counts = {
    shared_id: 0,
    cpf: 0,
    email: 0,
    phone: 0,
    exact_name: 0,
    unmatched: 0,
    ambiguous: 0,
  };
  const reasonMap = {
    linked_user_id: "shared_id",
    cpf: "cpf",
    email: "email",
    phone: "phone",
    name: "exact_name",
  };
  for (const uid of pharusUserIds) {
    const id = String(uid);
    if (crosswalk.ambiguousUserIds.has(id)) {
      counts.ambiguous += 1;
      continue;
    }
    if (crosswalk.byUserId.has(id)) {
      const reason = crosswalk.reasonByUserId.get(id) || "email";
      const key = reasonMap[reason] || "email";
      counts[key] += 1;
    } else {
      counts.unmatched += 1;
    }
  }
  return counts;
}

export function crosswalkAuditFromParts({ clientsRaw = [], baseClients = [], pharusRows = [] } = {}) {
  const qvClientIdsWithMechanisms = new Set(baseClients.map((c) => String(c.clientId)));
  const pharusUserIds = new Set(
    pharusRows.map((r) => String(r.userId || r.user_id || "")).filter(Boolean),
  );
  const profiles = new Map();
  for (const row of pharusRows) {
    const uid = String(row.userId || row.user_id || "");
    if (!uid) continue;
    profiles.set(uid, {
      name: row.userName || row.name || null,
      email: row.userEmail || row.email || null,
      cpf: row.cpf || null,
      phone: row.phone || null,
    });
  }
  const crosswalk = buildPharusClientCrosswalk(clientsRaw, profiles);
  const clientAudit = auditPharusClientCrosswalk(crosswalk, {
    qvClientIdsWithMechanisms,
    pharusUserIdsWithMechanisms: pharusUserIds,
  });
  return {
    crosswalk,
    clientAudit,
    matchMethods: auditMatchMethods(crosswalk, pharusUserIds),
  };
}
