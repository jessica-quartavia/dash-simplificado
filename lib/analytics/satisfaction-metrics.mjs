/**
 * Métricas — Pesquisa de Satisfação (V2).
 * NPS: última resposta válida por cliente no recorte filtrado (regra V1/consolidada).
 */
import { distributionFrom } from "./meeting-metrics.mjs";

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function npsScore(score) {
  if (score == null || score === "") return null;
  const value = Number(score);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function calcNps(scores) {
  const valid = scores.filter((score) => score != null);
  if (!valid.length) return null;
  const promoters = valid.filter((score) => score >= 9).length;
  const detractors = valid.filter((score) => score <= 6).length;
  return round1(pct(promoters, valid.length) - pct(detractors, valid.length));
}

function average(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return round1(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

export function summarizeSatisfactionRows(rows, populationTotal = null) {
  const list = Array.isArray(rows) ? rows : [];
  const portfolio = populationTotal ?? list.length;
  const withFeedback = list.filter((r) => (r.npsResponses || 0) > 0 || (r.csatResponses || 0) > 0);
  const npsScores = list.map((r) => npsScore(r.latestNps)).filter((s) => s != null);
  const csatScores = list.flatMap((r) => {
    if (r.averageCsat == null || !(r.csatResponses > 0)) return [];
    return Array(Math.min(r.csatResponses, 50)).fill(Math.min(Number(r.averageCsat), 5));
  });
  const satisfiedCsat = csatScores.filter((s) => s === 5).length;
  const latestRow = [...list]
    .filter((r) => r.latestNpsAt)
    .sort((a, b) => new Date(b.latestNpsAt) - new Date(a.latestNpsAt))[0];

  return {
    nps: calcNps(npsScores),
    latestNps: latestRow ? npsScore(latestRow.latestNps) : null,
    latestNpsAt: latestRow?.latestNpsAt || null,
    npsResponses: list.reduce((sum, r) => sum + (r.npsResponses || 0), 0),
    npsDistinctClients: npsScores.length,
    promoters: npsScores.filter((s) => s >= 9).length,
    neutrals: npsScores.filter((s) => s >= 7 && s <= 8).length,
    detractors: npsScores.filter((s) => s <= 6).length,
    csatAverage: average(list.map((r) => r.averageCsat).filter((v) => v != null)),
    csatResponses: list.reduce((sum, r) => sum + (r.csatResponses || 0), 0),
    csatSatisfiedPercent: pct(satisfiedCsat, csatScores.length),
    clientsWithFeedback: withFeedback.length,
    feedbackCoveragePercent: pct(withFeedback.length, portfolio),
    npsCoveragePercent: pct(npsScores.length, portfolio),
  };
}

export function distributionsFromSatisfactionRows(rows, payloadDistributions = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const npsScores = list.map((r) => npsScore(r.latestNps)).filter((s) => s != null);
  const promoters = npsScores.filter((s) => s >= 9).length;
  const neutrals = npsScores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = npsScores.filter((s) => s <= 6).length;
  const csatScores = list.flatMap((r) => {
    if (r.averageCsat == null || !(r.csatResponses > 0)) return [];
    return Array(Math.min(r.csatResponses, 50)).fill(Math.min(Number(r.averageCsat), 5));
  });
  const satisfied = csatScores.filter((s) => s === 5).length;

  return {
    npsClassification: [
      { label: "Promotores", count: promoters, percent: pct(promoters, npsScores.length) },
      { label: "Neutros", count: neutrals, percent: pct(neutrals, npsScores.length) },
      { label: "Detratores", count: detractors, percent: pct(detractors, npsScores.length) },
    ],
    csatSatisfaction: [
      { label: "Satisfeitos (5)", count: satisfied, percent: pct(satisfied, csatScores.length) },
      {
        label: "Não satisfeitos (1-4)",
        count: Math.max(0, csatScores.length - satisfied),
        percent: pct(Math.max(0, csatScores.length - satisfied), csatScores.length),
      },
    ],
    npsQuarterly: payloadDistributions.npsQuarterly || [],
  };
}
