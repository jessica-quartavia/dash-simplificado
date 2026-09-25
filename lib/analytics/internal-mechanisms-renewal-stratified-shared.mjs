/**
 * Estimador estratificado (Modelo A/B1) — programa × faixa de mecanismos.
 * Cópia estável dos parâmetros de internal-mechanisms-renewal-exploratory-projection.mjs
 * sem alterar o caminho do Modelo A em produção.
 */
export const STRATIFIED_MIN_STRATUM = 5;
export const STRATIFIED_SHRINKAGE_EVENTS = 2;
export const STRATIFIED_CLIP = Object.freeze({ low: 0.05, high: 0.95 });

export function mechanismBand(n) {
  const x = Number(n) || 0;
  if (x >= 4) return "4+";
  return String(x);
}

export function stratumKey(c) {
  const program = c.program || c.programa || "?";
  const count = c.mechanismCountAtReference ?? c.totalImplementedMechanisms ?? c.mechanismCount ?? 0;
  return `${program}/${mechanismBand(count)}`;
}

export function buildStrataRates(training) {
  const global = training.filter((c) => c.y === 0 || c.y === 1);
  const baseRate = global.length ? global.filter((c) => c.y === 1).length / global.length : null;
  const strata = new Map();
  for (const c of training) {
    if (c.y !== 0 && c.y !== 1) continue;
    const k = stratumKey(c);
    if (!strata.has(k)) strata.set(k, { n: 0, events: 0 });
    const s = strata.get(k);
    s.n += 1;
    if (c.y === 1) s.events += 1;
  }
  const rates = new Map();
  for (const [k, s] of strata.entries()) {
    if (s.n < STRATIFIED_MIN_STRATUM) continue;
    const raw = s.events / s.n;
    const shrunk =
      (s.events + STRATIFIED_SHRINKAGE_EVENTS * (baseRate ?? 0.2)) / (s.n + STRATIFIED_SHRINKAGE_EVENTS);
    rates.set(k, { n: s.n, events: s.events, rate: shrunk, rawRate: raw });
  }
  return { baseRate, rates };
}

export function predictStratifiedClient(c, model) {
  const k = stratumKey(c);
  const hit = model.rates.get(k);
  const p = hit ? hit.rate : model.baseRate ?? 0.2;
  return Math.min(STRATIFIED_CLIP.high, Math.max(STRATIFIED_CLIP.low, p));
}

/** Mesmo holdout 20% do Modelo A (seed=42). */
export function hashHoldout(clientId, seed = 42) {
  const s = String(clientId ?? "");
  let h = seed;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 100) < 20;
}
