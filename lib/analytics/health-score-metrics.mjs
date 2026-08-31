/**
 * Health Score — métricas determinísticas (Reuniões + Possui mecanismo).
 * Features oficiais: meetingCount, hasMechanism (Análises Estatísticas).
 */
export const DEFAULT_MECHANISM_SLIDER = 0.5;
export const HEALTH_SCORE_SLIDER_STEP = 0.05;
export const DEFAULT_HEALTH_SCORE_WEIGHTS = Object.freeze({ meetings: 50, mechanism: 50 });
/** @deprecated use HEALTH_SCORE_SLIDER_STEP */
export const HEALTH_SCORE_WEIGHT_STEP = 5;

/** Faixas alinhadas ao protótipo dash-health-score (experimental). */
export const HEALTH_SCORE_CLASS_THRESHOLDS = Object.freeze({
  healthyMin: 75,
  attentionMin: 50,
});

export const HEALTH_SCORE_CLASS_LABELS = Object.freeze({
  healthy: "Saudável",
  attention: "Atenção",
  critical: "Crítico",
  no_data: "Sem dados",
});

export const HEALTH_SCORE_METHODOLOGY = Object.freeze({
  variables: [
    {
      id: "meetingCount",
      label: "Engajamento (Reuniões)",
      featureId: "meetingCount",
      tooltip:
        "Representa o nível de interação do cliente através das reuniões. Menor interação reduz o score.",
      scoreRule:
        "Percentil 0–100 do total de reuniões oficiais (client_meetings + manual exclusivo) dentro do recorte filtrado. Mais reuniões → score maior.",
    },
    {
      id: "hasMechanism",
      label: "Mecanismos",
      featureId: "hasMechanism",
      tooltip:
        "Verifica se o cliente possui pelo menos um mecanismo. Não possuir mecanismo reduz o score.",
      scoreRule: "Possui mecanismo = 100 · Não possui = 0 (vínculo deduplicado na BASE QV, qualquer status).",
    },
  ],
  formula:
    "Health Score = (ScoreReuniões × PesoReuniões) + (ScoreMecanismo × PesoMecanismo), com pesos em decimal somando 1.",
  classification: {
    healthy: "≥ 75 — Saudável",
    attention: "50 a 74 — Atenção",
    critical: "< 50 — Crítico",
    noData:
      "Sem reunião registrada e sem mecanismo — fora da distribuição (não classificado como Crítico automaticamente).",
    experimental:
      "Faixas e pesos são experimentais. Não representam previsão validada de cancelamento.",
  },
  noDataRule: "meetingCount === 0 e hasMechanism !== true",
  defaultWeights: DEFAULT_HEALTH_SCORE_WEIGHTS,
  defaultMechanismSlider: DEFAULT_MECHANISM_SLIDER,
});

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pct(part, total) {
  if (!total) return 0;
  return round1((part / total) * 100);
}

export function normalizeMechanismSlider(value = DEFAULT_MECHANISM_SLIDER) {
  let slider = Number(value);
  if (!Number.isFinite(slider)) slider = DEFAULT_MECHANISM_SLIDER;
  slider = Math.round(slider / HEALTH_SCORE_SLIDER_STEP) * HEALTH_SCORE_SLIDER_STEP;
  return Math.max(0, Math.min(1, slider));
}

/** Slider = peso de mecanismos (0–1). Retorna pesos em percentual + valor do slider. */
export function weightsFromMechanismSlider(sliderValue = DEFAULT_MECHANISM_SLIDER) {
  const mechanismSlider = normalizeMechanismSlider(sliderValue);
  const meetings = round1((1 - mechanismSlider) * 100);
  const mechanism = round1(mechanismSlider * 100);
  return { mechanismSlider, meetings, mechanism };
}

export function weightSplitLabel(weights = DEFAULT_HEALTH_SCORE_WEIGHTS) {
  const w = weights.mechanismSlider != null
    ? weightsFromMechanismSlider(weights.mechanismSlider)
    : normalizeHealthScoreWeights(weights);
  return `${Math.round(w.meetings)} / ${Math.round(w.mechanism)}`;
}

export function normalizeHealthScoreWeights(input = {}) {
  if (input.mechanismSlider != null) return weightsFromMechanismSlider(input.mechanismSlider);
  const rawMeetings = Number(input.meetings);
  let meetings = Number.isFinite(rawMeetings) ? rawMeetings : DEFAULT_HEALTH_SCORE_WEIGHTS.meetings;
  meetings = Math.round(meetings / HEALTH_SCORE_WEIGHT_STEP) * HEALTH_SCORE_WEIGHT_STEP;
  meetings = Math.max(0, Math.min(100, meetings));
  return { meetings, mechanism: 100 - meetings, mechanismSlider: round1((100 - meetings) / 100) };
}

export function syncWeightsFromMeetings(meetings) {
  return normalizeHealthScoreWeights({ meetings });
}

export function syncWeightsFromMechanism(mechanism) {
  const raw = Number(mechanism);
  let mechanismPct = Number.isFinite(raw) ? raw : DEFAULT_HEALTH_SCORE_WEIGHTS.mechanism;
  mechanismPct = Math.round(mechanismPct / HEALTH_SCORE_WEIGHT_STEP) * HEALTH_SCORE_WEIGHT_STEP;
  mechanismPct = Math.max(0, Math.min(100, mechanismPct));
  return normalizeHealthScoreWeights({ mechanism: mechanismPct });
}

/** Cliente sem reunião e sem mecanismo — fora da amostra pontuável (protótipo). */
export function isHealthScoreNoData(client = {}) {
  const meetingCount = client.meetingCount ?? 0;
  return meetingCount === 0 && client.hasMechanism !== true;
}

export function mechanismScoreFromHas(hasMechanism) {
  return hasMechanism === true ? 100 : 0;
}

/**
 * Percentil 0–100 de meetingCount entre clientes pontuáveis do recorte.
 * Empates recebem a posição média.
 */
export function meetingScoresFromCounts(meetingCounts = []) {
  const n = meetingCounts.length;
  const scores = new Array(n);
  if (!n) return scores;
  if (n === 1) {
    scores[0] = meetingCounts[0] > 0 ? 100 : 0;
    return scores;
  }
  const indexed = meetingCounts.map((count, index) => ({ count: Number(count) || 0, index }));
  indexed.sort((a, b) => a.count - b.count);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && indexed[end + 1].count === indexed[start].count) end += 1;
    const avgRank = (start + end) / 2;
    const score = round1((avgRank / (n - 1)) * 100);
    for (let i = start; i <= end; i += 1) scores[indexed[i].index] = score;
    start = end + 1;
  }
  return scores;
}

export function computeMeetingScoreMap(scorableClients = []) {
  const counts = scorableClients.map((c) => c.meetingCount ?? 0);
  const scores = meetingScoresFromCounts(counts);
  const map = new Map();
  scorableClients.forEach((client, index) => {
    map.set(String(client.clientId), scores[index]);
  });
  return map;
}

export function computeFinalHealthScore(meetingScore, mechanismScore, weights = DEFAULT_HEALTH_SCORE_WEIGHTS) {
  if (meetingScore == null || mechanismScore == null) return null;
  const w = normalizeHealthScoreWeights(weights);
  const meetingWeight = w.mechanismSlider != null ? 1 - w.mechanismSlider : w.meetings / 100;
  const mechanismWeight = w.mechanismSlider != null ? w.mechanismSlider : w.mechanism / 100;
  const value = meetingScore * meetingWeight + mechanismScore * mechanismWeight;
  return Math.max(0, Math.min(100, round1(value)));
}

export function classifyHealthScore(score) {
  if (score == null || !Number.isFinite(Number(score))) return "no_data";
  const n = Number(score);
  if (n >= HEALTH_SCORE_CLASS_THRESHOLDS.healthyMin) return "healthy";
  if (n >= HEALTH_SCORE_CLASS_THRESHOLDS.attentionMin) return "attention";
  return "critical";
}

export function healthScoreClassLabel(classification) {
  return HEALTH_SCORE_CLASS_LABELS[classification] || "Sem dados";
}

export function enrichHealthScoreClients(clients = [], weights = DEFAULT_HEALTH_SCORE_WEIGHTS) {
  const list = Array.isArray(clients) ? clients : [];
  const scorable = list.filter((c) => !isHealthScoreNoData(c));
  const meetingScoreMap = computeMeetingScoreMap(scorable);

  return list.map((client) => {
    const noData = isHealthScoreNoData(client);
    const meetingScore = noData ? null : meetingScoreMap.get(String(client.clientId)) ?? 0;
    const mechanismScore = noData ? null : mechanismScoreFromHas(client.hasMechanism === true);
    const healthScore = noData ? null : computeFinalHealthScore(meetingScore, mechanismScore, weights);
    const classification = noData ? "no_data" : classifyHealthScore(healthScore);
    return {
      ...client,
      meetingScore,
      mechanismScore,
      healthScore,
      classification,
      classificationLabel: healthScoreClassLabel(classification),
      hasMechanismLabel: client.hasMechanism === true ? "Sim" : "Não",
    };
  });
}

export function summarizeHealthScoreDistribution(enrichedClients = []) {
  const list = Array.isArray(enrichedClients) ? enrichedClients : [];
  const scorable = list.filter((c) => c.classification !== "no_data");
  const noData = list.length - scorable.length;
  const buckets = {
    healthy: scorable.filter((c) => c.classification === "healthy"),
    attention: scorable.filter((c) => c.classification === "attention"),
    critical: scorable.filter((c) => c.classification === "critical"),
  };
  const scores = scorable.map((c) => c.healthScore).filter((v) => v != null);
  const averageScore = scores.length
    ? round1(scores.reduce((sum, v) => sum + v, 0) / scores.length)
    : null;

  return {
    filteredClients: list.length,
    scorableClients: scorable.length,
    noDataClients: noData,
    averageScore,
    distribution: ["healthy", "attention", "critical"].map((key) => ({
      key,
      label: HEALTH_SCORE_CLASS_LABELS[key],
      count: buckets[key].length,
      percent: pct(buckets[key].length, scorable.length),
    })),
    noData: {
      key: "no_data",
      label: HEALTH_SCORE_CLASS_LABELS.no_data,
      count: noData,
      percent: pct(noData, list.length),
    },
  };
}

export function meetingCountDistribution(enrichedClients = []) {
  const scorable = (enrichedClients || []).filter((c) => c.classification !== "no_data");
  const bands = [
    { label: "0 reuniões", test: (n) => n === 0 },
    { label: "1 reunião", test: (n) => n === 1 },
    { label: "2–3 reuniões", test: (n) => n >= 2 && n <= 3 },
    { label: "4–6 reuniões", test: (n) => n >= 4 && n <= 6 },
    { label: "7+ reuniões", test: (n) => n >= 7 },
  ];
  return bands.map((band) => {
    const count = scorable.filter((c) => band.test(Number(c.meetingCount) || 0)).length;
    return { label: band.label, count, percent: pct(count, scorable.length) };
  });
}

export function mechanismPossessionDistribution(enrichedClients = []) {
  const scorable = (enrichedClients || []).filter((c) => c.classification !== "no_data");
  const withMechanism = scorable.filter((c) => c.hasMechanism === true).length;
  const withoutMechanism = scorable.length - withMechanism;
  return [
    { label: "Possui mecanismo", count: withMechanism, percent: pct(withMechanism, scorable.length) },
    { label: "Não possui mecanismo", count: withoutMechanism, percent: pct(withoutMechanism, scorable.length) },
  ];
}

export function buildHealthScoreAnalysis(clients = [], weights = DEFAULT_HEALTH_SCORE_WEIGHTS) {
  const enriched = enrichHealthScoreClients(clients, weights);
  const summary = summarizeHealthScoreDistribution(enriched);
  return {
    weights: normalizeHealthScoreWeights(weights),
    summary,
    meetingDistribution: meetingCountDistribution(enriched),
    mechanismDistribution: mechanismPossessionDistribution(enriched),
    clients: enriched.sort((a, b) => {
      const av = a.healthScore;
      const bv = b.healthScore;
      if (av == null && bv == null) return String(a.clientName).localeCompare(String(b.clientName), "pt-BR");
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv || String(a.clientName).localeCompare(String(b.clientName), "pt-BR");
    }),
  };
}
