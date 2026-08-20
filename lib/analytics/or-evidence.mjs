/**
 * Evidências com OR: totalDistinct = A ∪ B (nunca A+B).
 */
export function buildOrEvidenceGroup({
  stage,
  ruleDescription,
  sources = [],
  universeSize = null,
}) {
  const sets = sources.map((s) => ({
    key: s.key,
    label: s.label,
    set: s.set instanceof Set ? s.set : new Set(s.ids || []),
  }));
  const union = new Set();
  for (const s of sets) {
    for (const id of s.set) union.add(id);
  }
  let overlapClients = 0;
  if (sets.length >= 2) {
    const [a, b] = sets;
    for (const id of a.set) {
      if (b.set.has(id)) overlapClients += 1;
    }
  }
  const totalDistinctClients = union.size;
  const percentage =
    universeSize != null && universeSize > 0
      ? Math.round((totalDistinctClients / universeSize) * 1000) / 10
      : null;
  return {
    stage,
    totalDistinctClients,
    sources: sets.map((s) => ({
      key: s.key,
      label: s.label,
      clients: s.set.size,
    })),
    overlapClients,
    percentage,
    ruleDescription: ruleDescription || "",
  };
}

export function foldStatusName(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function statusNameMatches(name, patterns) {
  const n = foldStatusName(name);
  return (patterns || []).some((p) => n.includes(foldStatusName(p)));
}
