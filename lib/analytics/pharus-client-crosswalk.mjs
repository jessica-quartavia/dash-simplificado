/**
 * Crosswalk App Pharus user_id ↔ BASE QV client_id (somente leitura).
 * Ordem fixa (sem fuzzy): ID compartilhado → CPF → e-mail → telefone → nome exato.
 */
import { foldToken } from "./mechanism-metrics.mjs";

function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePersonName(value) {
  return foldToken(value);
}

function identityDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function uniqueClientIndex(clients, valueOf) {
  const index = new Map();
  for (const client of clients || []) {
    const value = valueOf(client);
    if (!value) continue;
    if (!index.has(value)) index.set(value, []);
    index.get(value).push(String(client.id));
  }
  return index;
}

const MATCH_REASONS = Object.freeze([
  ["linked_user_id", (profile, uid) => uid, (client) => String(client.linked_user_id || "").trim()],
  ["cpf", (profile) => identityDigits(profile.cpf), (client) => identityDigits(client.cpf_digits)],
  ["email", (profile) => normalizeIdentityText(profile.email), (client) => normalizeIdentityText(client.email)],
  ["phone", (profile) => identityDigits(profile.phone), (client) => identityDigits(client.phone_digits || client.phone)],
  ["name", (profile) => normalizePersonName(profile.name), (client) => normalizePersonName(client.name)],
]);

/**
 * @param {Map<string, { name?, email?, cpf?, phone? }>} profiles
 */
export function buildPharusClientCrosswalk(clients, profiles) {
  const indexes = new Map(
    MATCH_REASONS.map(([reason, , clientValueOf]) => [reason, uniqueClientIndex(clients, clientValueOf)]),
  );

  const ambiguousUserIds = new Set();
  const byUserId = new Map();
  const reasonByUserId = new Map();

  for (const [userId, profile] of profiles.entries()) {
    const uid = String(userId);
    for (const [reason, profileValueOf] of MATCH_REASONS) {
      const value = profileValueOf(profile, uid);
      if (!value) continue;
      const candidates = indexes.get(reason)?.get(value) || [];
      if (candidates.length === 1) {
        byUserId.set(uid, candidates[0]);
        reasonByUserId.set(uid, reason);
        break;
      }
      if (candidates.length > 1) {
        ambiguousUserIds.add(uid);
        break;
      }
    }
  }

  return {
    byUserId,
    reasonByUserId,
    ambiguousUserIds,
    qvClientIdsWithMechanisms: new Set(),
  };
}

export function auditPharusClientCrosswalk(crosswalk, {
  qvClientIdsWithMechanisms = new Set(),
  pharusUserIdsWithMechanisms = new Set(),
} = {}) {
  const matchedUserIds = [...pharusUserIdsWithMechanisms].filter((id) => crosswalk.byUserId.has(String(id)));
  const pharusOnlyUsers = [...pharusUserIdsWithMechanisms].filter(
    (id) => !crosswalk.byUserId.has(String(id)) && !crosswalk.ambiguousUserIds.has(String(id)),
  );
  const pharusUnmatched = [...pharusUserIdsWithMechanisms].filter(
    (id) => !crosswalk.byUserId.has(String(id)),
  );
  const matchedQvIds = new Set(matchedUserIds.map((id) => crosswalk.byUserId.get(String(id))));
  const qvOnlyList = [...qvClientIdsWithMechanisms].filter((id) => !matchedQvIds.has(String(id)));

  const matchedInBoth = matchedUserIds.length;
  const baseQvOnly = qvOnlyList.length;
  const unmatchedAppPharus = pharusOnlyUsers.length;
  const ambiguous = crosswalk.ambiguousUserIds.size;
  const consolidatedUniquePeople = matchedInBoth + baseQvOnly + unmatchedAppPharus;
  const rawSum = qvClientIdsWithMechanisms.size + pharusUserIdsWithMechanisms.size;

  let consolidationMode = "base_qv_only";
  if (pharusUserIdsWithMechanisms.size > 0) {
    consolidationMode = ambiguous > 0 || unmatchedAppPharus > 0 ? "partial" : "full";
  }

  return {
    qvClientsWithMechanisms: qvClientIdsWithMechanisms.size,
    pharusUsersWithMechanisms: pharusUserIdsWithMechanisms.size,
    presentInBothSources: matchedInBoth,
    matchedInBoth,
    qvOnly: baseQvOnly,
    baseQvOnly,
    pharusOnly: unmatchedAppPharus,
    unmatchedAppPharus,
    pharusWithoutMatch: pharusUnmatched.length,
    ambiguousMatches: ambiguous,
    ambiguous,
    matchedUserIds: matchedUserIds.length,
    consolidatedUniquePeople,
    consolidationMode,
    rawSum,
    formulaValidated: consolidatedUniquePeople === matchedInBoth + baseQvOnly + unmatchedAppPharus,
  };
}

export function canonicalClientIdForPharusUser(userId, crosswalk) {
  const uid = String(userId);
  if (crosswalk.byUserId.has(uid)) {
    return { canonicalClientId: crosswalk.byUserId.get(uid), source: "matched", matchReason: crosswalk.reasonByUserId.get(uid) || null };
  }
  if (crosswalk.ambiguousUserIds.has(uid)) {
    return { canonicalClientId: `pharus:ambiguous:${uid}`, source: "ambiguous", matchReason: "ambiguous" };
  }
  return { canonicalClientId: `pharus:${uid}`, source: "pharus_only", matchReason: null };
}
