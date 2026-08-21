/**
 * Matching de identidade entre App Pharus e BASE QV (fidelidade V1).
 * Prioridade: id compartilhado > CPF > e-mail > telefone > nome exato.
 * Sem fuzzy. Ambíguos não são escolhidos arbitrariamente.
 */
function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

export function foldName(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEmail(raw) {
  const s = String(blankToNull(raw) || "").trim().toLowerCase();
  if (!s || !s.includes("@")) return null;
  return s;
}

export function normalizeCpf(raw) {
  const digits = String(blankToNull(raw) || "").replace(/\D/g, "");
  if (digits.length !== 11) return null;
  if (/^(\d)\1{10}$/.test(digits)) return null;
  return digits;
}

export function normalizePhone(raw) {
  let digits = String(blankToNull(raw) || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return null;
  return digits;
}

function indexBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/**
 * @param {Array} qvClients — { id, codigo, name, email, cpf, phone, linked_user_id, mechanismCount }
 * @param {Array} pharusUsers — { userId, name, email, cpf, phone, mechanismCount }
 */
export function matchPharusToBaseQv(qvClients = [], pharusUsers = []) {
  const qv = (qvClients || []).map((c) => ({
    id: String(c.id || c.clientId),
    codigo: blankToNull(c.codigo || c.clientCode),
    name: blankToNull(c.name || c.clientName),
    email: normalizeEmail(c.email),
    cpf: normalizeCpf(c.cpf || c.cpf_digits || c.documento),
    phone: normalizePhone(c.phone || c.phone_digits || c.telefone),
    linkedUserId: String(c.linked_user_id || c.linkedUserId || "").trim() || null,
    engineer: blankToNull(c.engineer || c.engenheiro_patrimonial),
    mechanismCount: Number(c.mechanismCount || c.available || 0) || 0,
  })).filter((c) => c.id);

  const byId = new Map(qv.map((c) => [c.id, c]));
  const byLinkedId = indexBy(qv, (c) => c.linkedUserId);
  const byCpf = indexBy(qv, (c) => c.cpf);
  const byEmail = indexBy(qv, (c) => c.email);
  const byPhone = indexBy(qv, (c) => c.phone);
  const byName = indexBy(qv, (c) => foldName(c.name));

  const rows = [];
  const warningsAgg = {
    pharusMissingIdentity: 0,
    ambiguousMatches: 0,
    unmatched: 0,
    nameOnlyMatches: 0,
    emailDuplicates: [...byEmail.values()].filter((a) => a.length > 1).length,
    cpfDuplicates: [...byCpf.values()].filter((a) => a.length > 1).length,
    phoneDuplicates: [...byPhone.values()].filter((a) => a.length > 1).length,
    qvMultiUser: 0,
  };

  const matchedQvIds = new Set();
  const qvToUsers = new Map();

  for (const u of pharusUsers || []) {
    const userId = String(u.userId || u.user_id || u.id || "");
    if (!userId) continue;
    const email = normalizeEmail(u.email);
    const cpf = normalizeCpf(u.cpf || u.cpf_digits || u.document);
    const phone = normalizePhone(u.phone || u.phone_digits || u.telefone);
    const name = blankToNull(u.name);
    const nameKey = foldName(name);
    const mechCount = Number(u.mechanismCount || u.mechanismsCount || 0) || 0;

    if (!email && !cpf && !phone && !nameKey) warningsAgg.pharusMissingIdentity += 1;

    let method = null;
    let candidates = [];
    let confidence = "none";

    if (byId.has(userId)) {
      candidates = [byId.get(userId)];
      method = "shared_id";
      confidence = "high";
    } else if (byLinkedId.has(userId)) {
      candidates = byLinkedId.get(userId);
      method = "linked_user_id";
      confidence = candidates.length === 1 ? "high" : "ambiguous";
    } else if (cpf && byCpf.has(cpf)) {
      candidates = byCpf.get(cpf);
      method = "cpf";
      confidence = candidates.length === 1 ? "high" : "ambiguous";
    } else if (email && byEmail.has(email)) {
      candidates = byEmail.get(email);
      method = "email";
      confidence = candidates.length === 1 ? "high" : "ambiguous";
    } else if (phone && byPhone.has(phone)) {
      candidates = byPhone.get(phone);
      method = "phone";
      confidence = candidates.length === 1 ? "high" : "ambiguous";
    } else if (nameKey && byName.has(nameKey)) {
      candidates = byName.get(nameKey);
      method = "name";
      confidence = candidates.length === 1 ? "low" : "ambiguous";
      if (candidates.length === 1) warningsAgg.nameOnlyMatches += 1;
    }

    let status = "unmatched";
    let matched = null;
    if (candidates.length === 1 && confidence !== "ambiguous") {
      matched = candidates[0];
      status = method === "name" ? "matched_name_only" : "matched";
      matchedQvIds.add(matched.id);
      if (!qvToUsers.has(matched.id)) qvToUsers.set(matched.id, new Set());
      qvToUsers.get(matched.id).add(userId);
    } else if (candidates.length > 1 || confidence === "ambiguous") {
      status = "ambiguous";
      warningsAgg.ambiguousMatches += 1;
    } else {
      warningsAgg.unmatched += 1;
    }

    rows.push({
      pharusUserId: userId,
      pharusName: name,
      pharusEmail: email,
      foundInBaseQv: Boolean(matched),
      clientId: matched?.id || null,
      clientCode: matched?.codigo || null,
      engineer: matched?.engineer || null,
      matchMethod: method,
      matchStatus: status,
      matchConfidence: confidence,
      candidateCount: candidates.length,
      pharusMechanismCount: mechCount,
      qvMechanismCount: matched?.mechanismCount || 0,
    });
  }

  for (const [, users] of qvToUsers) {
    if (users.size > 1) warningsAgg.qvMultiUser += 1;
  }

  const matchedInBoth = matchedQvIds.size;
  const baseQvClients = qv.length;
  const appPharusUsers = (pharusUsers || []).length;
  const ambiguousMatches = warningsAgg.ambiguousMatches;
  const unmatchedAppPharus = warningsAgg.unmatched;
  const baseQvOnly = Math.max(0, baseQvClients - matchedInBoth);
  const consolidatedUniquePeople = matchedInBoth + baseQvOnly + unmatchedAppPharus;

  return {
    crossSourceCoverage: {
      baseQvClients,
      appPharusUsers,
      matchedInBoth,
      baseQvOnly,
      appPharusOnly: unmatchedAppPharus,
      unmatchedAppPharus,
      ambiguousMatches,
      nameOnlyMatches: warningsAgg.nameOnlyMatches,
      consolidatedUniquePeople,
      consolidationMode: ambiguousMatches > 0 ? "partial" : "deduplicated",
      matchPriority: ["shared_id", "linked_user_id", "cpf", "email", "phone", "name"],
    },
    crossSourceRows: rows,
    warningsAgg,
  };
}

/** Converte resultado V1 para estrutura usada na consolidação V2. */
export function crosswalkFromIdentityMatch(qvClients = [], pharusUsers = []) {
  const matched = matchPharusToBaseQv(qvClients, pharusUsers);
  const byUserId = new Map();
  const reasonByUserId = new Map();
  const ambiguousUserIds = new Set();
  const methodMap = {
    shared_id: "linked_user_id",
    linked_user_id: "linked_user_id",
    cpf: "cpf",
    email: "email",
    phone: "phone",
    name: "name",
  };

  for (const row of matched.crossSourceRows) {
    const uid = String(row.pharusUserId);
    if (row.matchStatus === "ambiguous") {
      ambiguousUserIds.add(uid);
      continue;
    }
    if ((row.matchStatus === "matched" || row.matchStatus === "matched_name_only") && row.clientId) {
      byUserId.set(uid, String(row.clientId));
      reasonByUserId.set(uid, methodMap[row.matchMethod] || row.matchMethod || "email");
    }
  }

  return {
    byUserId,
    reasonByUserId,
    ambiguousUserIds,
    identityMatch: matched,
  };
}

export function auditMatchMethodsFromCrosswalk(crosswalk, pharusUserIds = []) {
  const counts = {
    shared_id: 0,
    linked_user_id: 0,
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
    if (crosswalk.ambiguousUserIds?.has(id)) {
      counts.ambiguous += 1;
      continue;
    }
    if (crosswalk.byUserId?.has(id)) {
      const reason = crosswalk.reasonByUserId?.get(id) || "email";
      const key = reasonMap[reason] || reason;
      if (key === "shared_id" && crosswalk.identityMatch?.crossSourceRows) {
        const row = crosswalk.identityMatch.crossSourceRows.find((r) => String(r.pharusUserId) === id);
        counts[row?.matchMethod === "linked_user_id" ? "linked_user_id" : "shared_id"] += 1;
      } else {
        counts[key] = (counts[key] || 0) + 1;
      }
    } else {
      counts.unmatched += 1;
    }
  }
  return counts;
}
