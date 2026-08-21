/**
 * Allowlist global do filtro Programa (Analytics V2).
 * Fonte: BASE QV public.clients (programa + davos_contrato_assinado).
 * Programa é atributo do cliente — nunca inferir por fonte técnica (App Pharus, Calendly, etc.).
 */
export const PROGRAM_ALLOWLIST = ["Pharus", "Davos"];

/** Alias explícito para UI/docs — mesma allowlist global. */
export const PROGRAM_FILTER_OPTIONS = PROGRAM_ALLOWLIST;

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

function isDavosContractSigned(row) {
  return row?.davosContractSigned === true || row?.davos_contrato_assinado === true;
}

export function programTokensFromRow(row) {
  const tokens = new Set();
  if (isDavosContractSigned(row)) tokens.add("Davos");
  const raw = row?.program ?? row?.programa ?? null;
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[;,|+]/);
  for (const value of values) {
    const normalized = normalizeProgramToken(value);
    if (normalized) tokens.add(normalized);
  }
  return tokens;
}

/**
 * Classificação normalizada do Programa do cliente (BASE QV).
 * @returns {"Pharus"|"Davos"|"Não informado"}
 */
export function resolveClientProgram(client) {
  if (!client) return "Não informado";
  if (isDavosContractSigned(client)) return "Davos";
  const tokens = programTokensFromRow(client);
  if (tokens.has("Davos") && !tokens.has("Pharus")) return "Davos";
  if (tokens.has("Pharus") && !tokens.has("Davos")) return "Pharus";
  if (tokens.has("Davos") && tokens.has("Pharus")) return "Davos";
  if (tokens.has("Pharus")) return "Pharus";
  if (tokens.has("Davos")) return "Davos";
  return "Não informado";
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
