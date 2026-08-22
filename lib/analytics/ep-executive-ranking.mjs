/**
 * Ranking executivo de EP — mesma população, filtros e mínimo de amostra da Performance por EP.
 */
export const EP_EXECUTIVE_MIN_SAMPLE = 10;

export function pickEligibleEpEngineers(engineers = [], minSample = EP_EXECUTIVE_MIN_SAMPLE) {
  return engineers.filter((e) => (e.totalClients || 0) >= minSample);
}

function pickExtreme(sorted, field, direction) {
  if (!sorted.length) return null;
  const pick = direction === "high" ? sorted[0] : sorted[sorted.length - 1];
  const value = pick?.[field];
  if (value == null) return null;
  const tied = sorted.filter((e) => e[field] === value).map((e) => e.engineer);
  return { engineer: pick.engineer, value, tied: tied.length > 1 ? tied : null, row: pick };
}

export function rankEpExtremes(engineers = [], field, { minSample = EP_EXECUTIVE_MIN_SAMPLE } = {}) {
  const eligible = pickEligibleEpEngineers(engineers, minSample);
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1));
  const high = pickExtreme(sorted, field, "high");
  const low = pickExtreme(sorted, field, "low");
  if (!high || !low) return null;
  return { minSample, high, low };
}

export function formatEpRenewedExtreme(extreme) {
  if (!extreme?.row) return null;
  return {
    engineer: extreme.engineer,
    percent: extreme.row.renewedPortfolioPercentage,
    renewed: extreme.row.renewedClients,
    base: extreme.row.totalClients,
    tied: extreme.tied,
  };
}

export function formatEpImplementationExtreme(extreme) {
  if (!extreme?.row) return null;
  return {
    engineer: extreme.engineer,
    percent: extreme.row.implementationShare,
    implementedClients: extreme.row.clientsWithImplementedMechanisms,
    base: extreme.row.totalClients,
    tied: extreme.tied,
  };
}

export function rankEpRenewedShare(engineers = [], options = {}) {
  const ranked = rankEpExtremes(engineers, "renewedPortfolioPercentage", options);
  if (!ranked) return null;
  return {
    minSample: ranked.minSample,
    high: formatEpRenewedExtreme(ranked.high),
    low: formatEpRenewedExtreme(ranked.low),
  };
}

export function rankEpImplementationShare(engineers = [], options = {}) {
  const ranked = rankEpExtremes(engineers, "implementationShare", options);
  if (!ranked) return null;
  return {
    minSample: ranked.minSample,
    high: formatEpImplementationExtreme(ranked.high),
    low: formatEpImplementationExtreme(ranked.low),
  };
}
