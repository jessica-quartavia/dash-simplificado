/**
 * Allowlist global do filtro Programa (Analytics V2).
 * Valores fora da lista não aparecem no seletor e não participam do match.
 */
export const PROGRAM_ALLOWLIST = ["Pharus", "Davos"];

const PROGRAM_ALIASES = new Map([
  ["pharus", "Pharus"],
  ["davos", "Davos"],
]);

export function normalizeProgramToken(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const folded = text.toLowerCase();
  if (PROGRAM_ALIASES.has(folded)) return PROGRAM_ALIASES.get(folded);
  if (/pharus/i.test(text)) return "Pharus";
  if (/davos/i.test(text)) return "Davos";
  return null;
}

export function programTokensFromRow(row) {
  const raw = row?.program ?? row?.programa ?? null;
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[;,|+]/);
  const tokens = new Set();
  for (const value of values) {
    const normalized = normalizeProgramToken(value);
    if (normalized) tokens.add(normalized);
  }
  return tokens;
}

/** Opções fixas do seletor: somente allowlist (Todos é adicionado pelo fill). */
export function programSelectOptions(_rows = []) {
  return [...PROGRAM_ALLOWLIST];
}

export function normalizeProgramFilter(value) {
  if (!value || value === "all") return "all";
  return normalizeProgramToken(value) || "all";
}

export function programMatches(row, selected) {
  if (!selected || selected === "all") return true;
  const normalized = normalizeProgramFilter(selected);
  if (normalized === "all") return true;
  return programTokensFromRow(row).has(normalized);
}
