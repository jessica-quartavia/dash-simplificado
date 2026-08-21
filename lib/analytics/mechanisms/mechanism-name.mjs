/**
 * Normalização de nomes de mecanismos para comparação (não implica equivalência).
 */
import { foldToken } from "../mechanism-metrics.mjs";

export function normalizeMechanismName(name) {
  const folded = foldToken(name);
  return folded
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mechanismNamesExact(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export function mechanismNamesNormalizedExact(a, b) {
  const na = normalizeMechanismName(a);
  const nb = normalizeMechanismName(b);
  return Boolean(na && nb && na === nb);
}

/** Sugestão conservadora — não consolida automaticamente. */
export function mechanismNamesProbablyRelated(a, b) {
  const na = normalizeMechanismName(a);
  const nb = normalizeMechanismName(b);
  if (!na || !nb || na === nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length >= 8 && longer.startsWith(shorter)) return true;
  return false;
}
