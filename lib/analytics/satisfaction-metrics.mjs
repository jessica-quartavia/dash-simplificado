/**
 * Métricas — Pesquisa de Satisfação (V2).
 * NPS headline: regra oficial nps-metrics (última por cliente, histórico).
 * CSAT: recorte trimestral / linhas filtradas (inalterado nesta rodada).
 */
import { npsClassificationDistribution } from "./satisfaction.mjs";

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

function average(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return round1(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

export function resolveSatisfactionNpsKpi(payload, scopedView = {}) {
  const population = payload?.population?.totalClients ?? 0;
  const filteredNps = scopedView?.filteredNps;
  const total = payload?.benchmarks?.total || payload?.summary || {};
  const source = filteredNps || total;
  return {
    nps: source?.nps ?? null,
    promoters: source?.promoters ?? 0,
    neutrals: source?.neutrals ?? 0,
    detractors: source?.detractors ?? 0,
    npsDistinctClients: source?.n ?? 0,
    npsResponses: source?.n ?? 0,
    npsCoveragePercent: population ? pct(source?.n ?? 0, population) : 0,
  };
}

export function summarizeSatisfactionRows(rows, populationTotal = null) {
  const list = Array.isArray(rows) ? rows : [];
  const portfolio = populationTotal ?? list.length;
  const withFeedback = list.filter((r) => (r.npsResponses || 0) > 0 || (r.csatResponses || 0) > 0);
  const csatScores = list.flatMap((r) => {
    if (r.averageCsat == null || !(r.csatResponses > 0)) return [];
    return Array(Math.min(r.csatResponses, 50)).fill(Math.min(Number(r.averageCsat), 5));
  });
  const satisfiedCsat = csatScores.filter((s) => s === 5).length;
  const latestRow = [...list]
    .filter((r) => r.latestNpsAt)
    .sort((a, b) => new Date(b.latestNpsAt) - new Date(a.latestNpsAt))[0];

  return {
    latestNps: latestRow ? npsScore(latestRow.latestNps) : null,
    latestNpsAt: latestRow?.latestNpsAt || null,
    csatAverage: average(list.map((r) => r.averageCsat).filter((v) => v != null)),
    csatResponses: list.reduce((sum, r) => sum + (r.csatResponses || 0), 0),
    csatSatisfiedPercent: pct(satisfiedCsat, csatScores.length),
    clientsWithFeedback: withFeedback.length,
    feedbackCoveragePercent: pct(withFeedback.length, portfolio),
  };
}

export function distributionsFromSatisfactionRows(rows, payloadDistributions = {}, npsKpi = null) {
  const list = Array.isArray(rows) ? rows : [];
  const csatScores = list.flatMap((r) => {
    if (r.averageCsat == null || !(r.csatResponses > 0)) return [];
    return Array(Math.min(r.csatResponses, 50)).fill(Math.min(Number(r.averageCsat), 5));
  });
  const satisfied = csatScores.filter((s) => s === 5).length;

  return {
    npsClassification: npsKpi
      ? npsClassificationDistribution(npsKpi)
      : payloadDistributions.npsClassification || [],
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
