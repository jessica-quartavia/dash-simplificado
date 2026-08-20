/**
 * Fonte única de verdade para ciclo / renovação (BASE QV · clients.ciclo).
 * Regra oficial do portal:
 *   hasRenewed = currentCycle > 1
 *   renewalCount = max(currentCycle - 1, 0)
 * Ciclo null / ≤0: inválido para análises de renovação (não conta como renovado).
 */

export function parseCurrentCycle(clientOrRaw) {
  const raw =
    clientOrRaw != null && typeof clientOrRaw === "object"
      ? (clientOrRaw.currentCycle ?? clientOrRaw.ciclo ?? clientOrRaw.cycle)
      : clientOrRaw;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * @returns {{
 *   currentCycle: number|null,
 *   renewalCount: number,
 *   hasRenewed: boolean,
 *   renewed: boolean,
 *   valid: boolean,
 *   renewedValid: boolean,
 *   invalidReason: string|null
 * }}
 */
export function renewalFromCycle(cycle) {
  if (cycle == null || !Number.isFinite(cycle)) {
    return {
      currentCycle: null,
      renewalCount: 0,
      hasRenewed: false,
      renewed: false,
      valid: false,
      renewedValid: false,
      invalidReason: "missing",
    };
  }
  const c = Math.trunc(cycle);
  if (c <= 0) {
    return {
      currentCycle: c,
      renewalCount: 0,
      hasRenewed: false,
      renewed: false,
      valid: false,
      renewedValid: false,
      invalidReason: c === 0 ? "zero" : "negative",
    };
  }
  const hasRenewed = c > 1;
  return {
    currentCycle: c,
    renewalCount: Math.max(c - 1, 0),
    hasRenewed,
    renewed: hasRenewed,
    valid: true,
    renewedValid: true,
    invalidReason: null,
  };
}

export function renewalFromClient(client) {
  return renewalFromCycle(parseCurrentCycle(client));
}

export function countRenewedClients(clients) {
  let n = 0;
  for (const c of clients || []) {
    if (renewalFromClient(c).hasRenewed) n += 1;
  }
  return n;
}

export function sumRenewalCounts(clients) {
  let n = 0;
  for (const c of clients || []) {
    n += renewalFromClient(c).renewalCount;
  }
  return n;
}

export function cycleDistributionLabel(cycle) {
  if (cycle == null || !Number.isFinite(cycle) || cycle <= 0) return "Não informado";
  const c = Math.trunc(cycle);
  if (c >= 5) return "Ciclo 5+";
  return `Ciclo ${c}`;
}

/** Data civil YYYY-MM-DD em America/Sao_Paulo (evita UTC mudar o dia). */
export function civilDateInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

/**
 * Data de calendário de um valor de contratação/registro.
 * Prefere o prefixo YYYY-MM-DD (comum em timestamps 00:00Z = dia civil na base).
 */
export function calendarDateFromValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export const PORTAL_TZ = "America/Sao_Paulo";
