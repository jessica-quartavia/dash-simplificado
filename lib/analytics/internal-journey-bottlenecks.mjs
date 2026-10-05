/**
 * Gargalos da Jornada — compute dedicado (BASE QV read-only).
 */
import { dataConfigurationError } from "../env.mjs";
import { runWithAnalyticsDataContext } from "./analytics-data-context.mjs";
import { preloadExecutiveSharedBundle } from "./executive-shared-bundle.mjs";
import { buildOnboardingPayload } from "./onboarding.mjs";
import { buildMeetingsPayload } from "./meetings.mjs";
import { loadMeetingTypesFromCalendly } from "./meeting-types-calendly.mjs";
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import { median, summarizeOnboardingRows } from "./onboarding-metrics.mjs";
import { resolveClientProgram } from "./filters/program.mjs";
import { sortLabelsUnknownLast, sortUnknownLast } from "./filters/sort-categories.mjs";
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import {
  filterJourneyBottleneckRows,
  normalizeInternalJourneyBottlenecksFilters,
  parseInternalJourneyBottlenecksFilters,
} from "./internal-journey-bottlenecks-filters.mjs";
import {
  buildFirstMeetingHeatmapInsights,
  buildJourneyBottleneckInsights,
  buildJourneyRecommendations,
} from "./internal-journey-bottlenecks-insights.mjs";
import { pickFiniteNumber, resolveEpWithoutMeetingFields } from "./internal-journey-bottlenecks-ep-fields.mjs";
import {
  expectedAttentionClientsTotal,
  resolveAttentionClientsAll,
} from "./internal-journey-bottlenecks-attention.mjs";

export const IJB_CALCULATION_VERSION = `ijb-v2-attn-full-ep-count-${CALCULATION_VERSION}`;
export const IJB_PAYLOAD_SCHEMA = "2026-10-05-attention-clients-hydrate";
export const IJB_EP_MIN_N = 30;

const RECENCY_CHART_BUCKETS = [
  { id: "0-15", label: "0–15", min: 0, max: 15 },
  { id: "16-30", label: "16–30", min: 16, max: 30 },
  { id: "31-60", label: "31–60", min: 31, max: 60 },
  { id: "61-90", label: "61–90", min: 61, max: 90 },
  { id: "90+", label: "90+", min: 91, max: Infinity },
  { id: "never", label: "Nunca reuniram", never: true },
];

const FIRST_MEETING_HEATMAP_BUCKETS = [
  { id: "0-7", label: "0–7 dias", min: 0, max: 7 },
  { id: "8-14", label: "8–14 dias", min: 8, max: 14 },
  { id: "15-30", label: "15–30 dias", min: 15, max: 30 },
  { id: "31-60", label: "31–60 dias", min: 31, max: 60 },
  { id: "61-90", label: "61–90 dias", min: 61, max: 90 },
  { id: "90+", label: "90+", min: 91, max: Infinity },
  { id: "never", label: "Sem primeira reunião", never: true },
];

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function labelOrUnknown(value) {
  return blankToNull(value) ?? "Não informado";
}

/** Dias sem reunião ≥ limiar: recência registrada ou sem 1ª reunião com tempo de carteira ≥ limiar. */
export function countDaysWithoutMeetingAtLeast(rows, minDays) {
  return (rows || []).filter((row) => {
    if (row.daysSinceLastMeeting != null && row.daysSinceLastMeeting >= minDays) return true;
    if (row.firstMeetingCompleted === false) {
      const tenure = row.tenureDays;
      if (tenure != null && tenure >= minDays) return true;
    }
    return false;
  }).length;
}

function clientsInFirstMeetingBucket(rows, bucket) {
  if (bucket.never) {
    return rows.filter((r) => r.firstMeetingCompleted === false);
  }
  return rows.filter((r) => {
    const d = r.daysToFirstMeeting;
    return d != null && Number.isFinite(d) && d >= bucket.min && d <= bucket.max;
  });
}

function tenureDays(row, now = new Date()) {
  const start = parseDate(row.contractDate || row.entryDate);
  if (!start) return null;
  return Math.max(
    0,
    Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
        / 86400000,
    ),
  );
}

/** Regra documentada — jornada parada (sinais BASE QV). */
export function classifyAttentionLevel(row, thresholds = {}) {
  const reasons = [];
  const p75Onboarding = thresholds.p75OnboardingDays;
  const p75FirstMeeting = thresholds.p75FirstMeetingDays;

  if (row.firstMeetingCompleted === false) reasons.push("Sem reunião");
  if (row.completedOnboarding === false) reasons.push("Onboarding incompleto");
  if (row.daysToPlanDelivery == null && row.completedOnboarding === false) reasons.push("Sem plano");
  if (row.daysToFirstImplementation == null && row.completedOnboarding === false) reasons.push("Sem mecanismo");
  if (row.daysToFirstMeeting != null && p75FirstMeeting != null && row.daysToFirstMeeting > p75FirstMeeting) {
    reasons.push("Primeira reunião atrasada");
  }
  if (row.totalOnboardingDays != null && p75Onboarding != null && row.totalOnboardingDays > p75Onboarding) {
    reasons.push("Onboarding muito longo");
  }
  const dsl = row.daysSinceLastMeeting;
  if (dsl != null && dsl >= 60) reasons.push("60+ dias sem reunião");
  else if (dsl != null && dsl >= 30) reasons.push("30+ dias sem reunião");

  let level = "Normal";
  if (
    row.completedOnboarding === false
    && (row.firstMeetingCompleted === false || (dsl != null && dsl >= 90))
  ) {
    level = "Crítico";
  } else if (reasons.length >= 2 || reasons.some((r) => r.includes("60+") || r.includes("Sem reunião"))) {
    level = "Atenção";
  } else if (reasons.length) {
    level = "Atenção";
  }

  return { level, reasons: [...new Set(reasons)] };
}

function mergeClientRows(onboardClients, meetClients, clientById, now) {
  const mMap = new Map((meetClients || []).map((r) => [String(r.clientId), r]));
  return (onboardClients || []).map((o) => {
    const m = mMap.get(String(o.clientId)) || {};
    const client = clientById.get(String(o.clientId));
    const segment = blankToNull(client?.segmentacao) ?? "Não informado";
    const program = resolveClientProgram(client || o);
    return {
      ...o,
      clientId: o.clientId,
      segment,
      program,
      programa: client?.programa,
      davos_contrato_assinado: client?.davos_contrato_assinado,
      engineer: labelOrUnknown(client?.engenheiro_patrimonial ?? o.engineer ?? m.engineer),
      entryDate: m.entryDate || o.contractDate,
      journeyMeetingsCount: m.journeyMeetingsCount ?? 0,
      hasValidMeeting: m.hasValidMeeting === true,
      totalMeetings: m.totalMeetings ?? 0,
      daysSinceLastMeeting: m.daysSinceLastMeeting ?? null,
      averageIntervalDays: m.averageIntervalDays ?? null,
      typicalIntervalDays: m.typicalIntervalDays ?? null,
      firstMeetingCompleted: m.firstMeetingCompleted ?? o.daysToFirstMeeting != null,
      firstMeetingDate: m.firstMeetingDate || o.firstMeetingDate,
      daysFromEntryToFirstMeeting: m.daysFromEntryToFirstMeeting ?? o.daysToFirstMeeting,
      tenureDays: tenureDays({ contractDate: o.contractDate, entryDate: m.entryDate }, now),
      hasPlan: o.daysToPlanDelivery != null,
      hasMechanism: o.daysToFirstImplementation != null,
      journeyStarted: Boolean(o.contractDate),
    };
  });
}

function buildFunnel(rows) {
  const total = rows.length || 1;
  const steps = [
    { id: "population", label: "Clientes no recorte", count: rows.length },
    {
      id: "journey_started",
      label: "Com data de entrada",
      count: rows.filter((r) => r.journeyStarted).length,
    },
    {
      id: "first_meeting",
      label: "Primeira reunião",
      count: rows.filter((r) => r.firstMeetingCompleted === true).length,
    },
    {
      id: "plan",
      label: "Entrega do plano",
      count: rows.filter((r) => r.daysToPlanDelivery != null).length,
    },
    {
      id: "first_mechanism",
      label: "Primeiro mecanismo",
      count: rows.filter((r) => r.daysToFirstImplementation != null).length,
    },
    {
      id: "onboarding_done",
      label: "Onboarding concluído",
      count: rows.filter((r) => r.completedOnboarding === true).length,
    },
  ];

  const enriched = steps.map((step, i) => {
    const prev = i > 0 ? steps[i - 1].count : step.count;
    const drop = i > 0 ? Math.max(0, prev - step.count) : 0;
    return {
      ...step,
      pctOfTotal: pct(step.count, total),
      pctOfPrevious: i > 0 ? pct(step.count, prev) : 100,
      dropOff: drop,
      dropOffPct: i > 0 ? pct(drop, prev) : 0,
    };
  });

  let mainBottleneck = null;
  for (let i = 1; i < enriched.length; i += 1) {
    const item = enriched[i];
    if (!mainBottleneck || (item.dropOffPct ?? 0) > (mainBottleneck.dropOffPct ?? 0)) {
      mainBottleneck = {
        label: item.label,
        dropOff: item.dropOff,
        dropOffPct: item.dropOffPct,
        fromCount: enriched[i - 1].count,
        toCount: item.count,
      };
    }
  }

  return { steps: enriched, mainBottleneck };
}

function buildVelocity(rows) {
  const pairs = [
    { id: "to_first_meeting", label: "Até 1ª reunião", values: rows.map((r) => r.daysToFirstMeeting) },
    { id: "to_plan", label: "Até entrega do plano", values: rows.map((r) => r.daysToPlanDelivery) },
    { id: "to_mechanism", label: "Até 1º mecanismo", values: rows.map((r) => r.daysToFirstImplementation) },
    { id: "onboarding_total", label: "Onboarding completo", values: rows.map((r) => r.totalOnboardingDays) },
  ].map((p) => {
    const clean = p.values.filter((v) => v != null && v >= 0).sort((a, b) => a - b);
    return {
      id: p.id,
      label: p.label,
      n: clean.length,
      medianDays: round1(median(clean)),
      p25Days: round1(quantile(clean, 0.25)),
      p75Days: round1(quantile(clean, 0.75)),
    };
  });

  const withData = pairs.filter((p) => p.medianDays != null);
  const slowest = [...withData].sort((a, b) => (b.medianDays ?? 0) - (a.medianDays ?? 0))[0] || null;
  return { steps: pairs, slowestStep: slowest };
}

function buildMeetingsSection(rows) {
  const n = rows.length || 1;
  const withMeeting = rows.filter((r) => r.hasValidMeeting || (r.totalMeetings ?? 0) > 0).length;
  const withoutMeeting = rows.filter((r) => r.firstMeetingCompleted === false).length;
  const firstDays = rows.map((r) => r.daysToFirstMeeting ?? r.daysFromEntryToFirstMeeting).filter((v) => v != null && v >= 0);
  const sorted = [...firstDays].sort((a, b) => a - b);
  const intervals = rows.map((r) => r.averageIntervalDays).filter((v) => v != null && v >= 0);

  const recencyChart = RECENCY_CHART_BUCKETS.map((b) => {
    if (b.never) {
      const count = rows.filter((r) => r.firstMeetingCompleted === false).length;
      return { bucket: b.label, count, sharePct: pct(count, n) };
    }
    const count = rows.filter(
      (r) => r.daysSinceLastMeeting != null && r.daysSinceLastMeeting >= b.min && r.daysSinceLastMeeting <= b.max,
    ).length;
    return { bucket: b.label, count, sharePct: pct(count, n) };
  });

  const dsl = rows.map((r) => r.daysSinceLastMeeting).filter((v) => v != null);
  const over30 = countDaysWithoutMeetingAtLeast(rows, 30);
  const over60 = countDaysWithoutMeetingAtLeast(rows, 60);
  const over90 = countDaysWithoutMeetingAtLeast(rows, 90);

  const observableFirstMeetingN = firstDays.length;
  const countWithin7 = observableFirstMeetingN ? firstDays.filter((v) => v <= 7).length : 0;
  const countWithin14 = observableFirstMeetingN ? firstDays.filter((v) => v <= 14).length : 0;
  const countWithin30 = observableFirstMeetingN ? firstDays.filter((v) => v <= 30).length : 0;
  const countOver30 = observableFirstMeetingN ? firstDays.filter((v) => v > 30).length : 0;
  const firstMeetingDenominatorNote =
    "Percentual calculado entre clientes com tempo até primeira reunião observável.";

  return {
    populationN: n,
    withMeeting,
    withMeetingPct: pct(withMeeting, n),
    withoutMeeting,
    withoutMeetingPct: pct(withoutMeeting, n),
    medianDaysToFirst: round1(median(sorted)),
    medianDaysSinceLast: round1(median(dsl)),
    meanIntervalDays: round1(intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null),
    medianMeetingsPerClient: round1(median(rows.map((r) => r.totalMeetings ?? 0))),
    count30PlusWithoutMeeting: over30,
    count60PlusWithoutMeeting: over60,
    count90PlusWithoutMeeting: over90,
    pct30PlusWithoutMeeting: pct(over30, n),
    pct60PlusWithoutMeeting: pct(over60, n),
    pct90PlusWithoutMeeting: pct(over90, n),
    recency: {
      populationN: n,
      count30Plus: over30,
      count60Plus: over60,
      count90Plus: over90,
      count30: over30,
      count60: over60,
      count90: over90,
      pct30Plus: pct(over30, n),
      pct60Plus: pct(over60, n),
      pct90Plus: pct(over90, n),
      chart: recencyChart,
    },
    firstMeeting: {
      observableCount: observableFirstMeetingN,
      denominatorNote: firstMeetingDenominatorNote,
      countWithin7,
      countWithin14,
      countWithin30,
      countOver30,
      pctWithin7: observableFirstMeetingN ? pct(countWithin7, observableFirstMeetingN) : null,
      pctWithin14: observableFirstMeetingN ? pct(countWithin14, observableFirstMeetingN) : null,
      pctWithin30: observableFirstMeetingN ? pct(countWithin30, observableFirstMeetingN) : null,
      pctOver30: observableFirstMeetingN ? pct(countOver30, observableFirstMeetingN) : null,
    },
  };
}

function buildRankings(rows) {
  const n = rows.length || 1;
  const items = [
    {
      id: "no_first_meeting",
      label: "Sem primeira reunião",
      clients: rows.filter((r) => r.firstMeetingCompleted === false).length,
    },
    {
      id: "open_onboarding_30",
      label: "Onboarding incompleto",
      clients: rows.filter((r) => r.completedOnboarding === false).length,
    },
    {
      id: "no_meeting_60",
      label: "60+ dias sem reunião",
      clients: rows.filter((r) => r.daysSinceLastMeeting != null && r.daysSinceLastMeeting >= 60).length,
    },
    {
      id: "no_plan",
      label: "Sem plano entregue",
      clients: rows.filter((r) => r.daysToPlanDelivery == null).length,
    },
    {
      id: "no_mechanism",
      label: "Sem primeiro mecanismo",
      clients: rows.filter((r) => r.daysToFirstImplementation == null).length,
    },
  ]
    .map((item) => ({
      ...item,
      sharePct: pct(item.clients, n),
    }))
    .sort((a, b) => b.clients - a.clients);

  return items;
}

function aggregateByEp(rows) {
  const map = new Map();
  for (const row of rows) {
    const ep = row.engineer || "Não informado";
    if (!map.has(ep)) map.set(ep, []);
    map.get(ep).push(row);
  }
  const out = [];
  for (const [ep, list] of map.entries()) {
    const ev = list.filter((r) => r.completedOnboarding != null);
    const completed = list.filter((r) => r.completedOnboarding === true).length;
    const onboardingDays = list.map((r) => r.totalOnboardingDays).filter((v) => v != null);
    const firstDays = list.map((r) => r.daysToFirstMeeting).filter((v) => v != null);
    const noMeet = list.filter((r) => r.firstMeetingCompleted === false).length;
    const d30 = countDaysWithoutMeetingAtLeast(list, 30);
    const d60 = countDaysWithoutMeetingAtLeast(list, 60);
    const d90 = countDaysWithoutMeetingAtLeast(list, 90);
    const withMech = list.filter((r) => r.hasMechanism).length;
    const meetingsPer = list.map((r) => r.totalMeetings ?? 0);
    out.push({
      ep,
      clients: list.length,
      onboardingCompletedPct: pct(completed, ev.length),
      medianOnboardingDays: round1(median(onboardingDays)),
      medianFirstMeetingDays: round1(median(firstDays)),
      withoutMeetingCount: noMeet,
      withoutMeeting: noMeet,
      withoutMeetingPct: pct(noMeet, list.length),
      semReuniaoCount: noMeet,
      semReuniaoPct: pct(noMeet, list.length),
      days30WithoutMeetingPct: pct(d30, list.length),
      days60WithoutMeetingPct: pct(d60, list.length),
      days90WithoutMeetingPct: pct(d90, list.length),
      medianMeetingsPerClient: round1(median(meetingsPer)),
      withMechanismPct: pct(withMech, list.length),
      smallSample: list.length < IJB_EP_MIN_N,
    });
  }
  return sortUnknownLast(out, (r) => r.ep, (a, b) => b.clients - a.clients);
}

function buildCancellationCompare(activeRows, cancelledRows) {
  const metric = (list) => {
    const n = list.length || 1;
    const firstDays = list.map((r) => r.daysToFirstMeeting).filter((v) => v != null);
    const ev = list.filter((r) => r.completedOnboarding != null);
    return {
      medianFirstMeeting: round1(median(firstDays)),
      onboardingCompletedPct: pct(list.filter((r) => r.completedOnboarding === true).length, ev.length),
      withoutMeetingPct: pct(list.filter((r) => r.firstMeetingCompleted === false).length, n),
      medianMeetings: round1(median(list.map((r) => r.totalMeetings ?? 0))),
      medianInterval: round1(median(list.map((r) => r.averageIntervalDays).filter((v) => v != null))),
      withMechanismPct: pct(list.filter((r) => r.hasMechanism).length, n),
      withPlanPct: pct(list.filter((r) => r.hasPlan).length, n),
      medianOnboardingDays: round1(median(list.map((r) => r.totalOnboardingDays).filter((v) => v != null))),
      medianDaysSinceLast: round1(median(list.map((r) => r.daysSinceLastMeeting).filter((v) => v != null))),
    };
  };
  const active = metric(activeRows);
  const cancelled = metric(cancelledRows);
  const rows = [
    { metric: "medianFirstMeeting", label: "Dias até 1ª reunião (mediana)", active: active.medianFirstMeeting, cancelled: cancelled.medianFirstMeeting },
    { metric: "onboardingCompletedPct", label: "Onboarding concluído %", active: active.onboardingCompletedPct, cancelled: cancelled.onboardingCompletedPct },
    { metric: "withoutMeetingPct", label: "Sem reunião %", active: active.withoutMeetingPct, cancelled: cancelled.withoutMeetingPct },
    { metric: "medianMeetings", label: "Reuniões por cliente (mediana)", active: active.medianMeetings, cancelled: cancelled.medianMeetings },
    { metric: "medianInterval", label: "Intervalo médio entre reuniões", active: active.medianInterval, cancelled: cancelled.medianInterval },
    { metric: "withMechanismPct", label: "Com mecanismo %", active: active.withMechanismPct, cancelled: cancelled.withMechanismPct },
    { metric: "withPlanPct", label: "Plano entregue %", active: active.withPlanPct, cancelled: cancelled.withPlanPct },
  ];
  return {
    activeN: activeRows.length,
    cancelledN: cancelledRows.length,
    rows,
    note: "Comparação exploratória entre ativos e cancelados efetivos no recorte — associação, não causalidade.",
  };
}

function buildQuality(rows) {
  const n = rows.length || 1;
  const gaps = [
    { id: "contract", label: "data de entrada", count: rows.filter((r) => !r.contractDate).length },
    { id: "onboarding", label: "status de onboarding", count: rows.filter((r) => r.completedOnboarding == null).length },
    { id: "first_meeting", label: "primeira reunião avaliável", count: rows.filter((r) => r.firstMeetingCompleted == null).length },
    { id: "ep", label: "EP", count: rows.filter((r) => !r.engineer || r.engineer === "Não informado").length },
    { id: "program", label: "programa", count: rows.filter((r) => r.program === "Não informado").length },
    { id: "segment", label: "segmento", count: rows.filter((r) => r.segment === "Não informado").length },
  ].map((g) => ({ ...g, pct: pct(g.count, n) }));
  const topGap = [...gaps].sort((a, b) => b.count - a.count)[0] || null;
  return { gaps, topGap, population: n };
}

export function buildFirstMeetingOnboardingHeatmap(rows) {
  const matrixRows = FIRST_MEETING_HEATMAP_BUCKETS.map((bucket) => {
    const list = clientsInFirstMeetingBucket(rows, bucket);
    const n = list.length;
    const completedCount = list.filter((r) => r.completedOnboarding === true).length;
    const notCompletedCount = list.filter((r) => r.completedOnboarding === false).length;
    return {
      bucket: bucket.label,
      bucketId: bucket.id,
      n,
      completed: {
        count: completedCount,
        pctOfRow: pct(completedCount, n),
      },
      notCompleted: {
        count: notCompletedCount,
        pctOfRow: pct(notCompletedCount, n),
      },
    };
  }).filter((row) => row.n > 0);

  return {
    rows: matrixRows,
    denominatorNote:
      "Percentuais calculados dentro de cada faixa de tempo até a primeira reunião (coluna ÷ clientes da faixa).",
  };
}

function paginateAttention(rows, page, pageSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(10, Number(pageSize) || 10));
  const start = (p - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    page: p,
    pageSize: size,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / size)),
  };
}

export function buildInternalJourneyBottlenecksPayload({
  unifiedRows,
  filters,
  meetingTypes,
  metadata = {},
  attentionPage = 1,
  attentionPageSize = 10,
  now = new Date(),
}) {
  const filtered = filterJourneyBottleneckRows(unifiedRows, filters, { now });
  const onboardSummary = summarizeOnboardingRows(filtered);
  const comparable = filtered.filter((r) => r.inComparableCohort);

  const onboardingDays = comparable.map((r) => r.totalOnboardingDays).filter((v) => v != null);
  const p75Onboarding = round1(quantile([...onboardingDays].sort((a, b) => a - b), 0.75));
  const firstDaysArr = filtered.map((r) => r.daysToFirstMeeting).filter((v) => v != null);
  const p75First = round1(quantile([...firstDaysArr].sort((a, b) => a - b), 0.75));

  const thresholds = { p75OnboardingDays: p75Onboarding, p75FirstMeetingDays: p75First };
  const withAttention = filtered.map((row) => {
    const { level, reasons } = classifyAttentionLevel(row, thresholds);
    return { ...row, attentionLevel: level, attentionReasons: reasons };
  });

  const stalled = withAttention.filter((r) => r.attentionLevel !== "Normal");
  const overlapNoMeetingAndOpenOnboarding = withAttention.filter(
    (r) => r.firstMeetingCompleted === false && r.completedOnboarding === false,
  ).length;

  const summary = {
    activeClients: filtered.length,
    completedOnboarding: onboardSummary.completedOnboarding,
    completedOnboardingPct: onboardSummary.completedPercent,
    openOnboarding: onboardSummary.openOnboarding,
    openOnboardingPct: pct(onboardSummary.openOnboarding, onboardSummary.completionBaseClients),
    medianOnboardingDays: onboardSummary.medianTotalOnboardingDays,
    medianFirstMeetingDays: onboardSummary.medianFirstMeetingDays,
    withoutAnyMeeting: filtered.filter((r) => r.firstMeetingCompleted === false).length,
    withoutAnyMeetingPct: pct(
      filtered.filter((r) => r.firstMeetingCompleted === false).length,
      filtered.length,
    ),
    medianDaysSinceLastMeeting: round1(
      median(filtered.map((r) => r.daysSinceLastMeeting).filter((v) => v != null)),
    ),
    stalledJourney: stalled.length,
    stalledJourneyPct: pct(stalled.length, filtered.length),
  };

  const funnel = buildFunnel(filtered);
  const velocity = buildVelocity(filtered);
  const meetings = buildMeetingsSection(filtered);
  const rankings = buildRankings(filtered);
  const epTable = aggregateByEp(filtered);
  const quality = buildQuality(filtered);
  const firstMeetingOnboardingHeatmap = buildFirstMeetingOnboardingHeatmap(filtered);

  const cancelledRows = filterJourneyBottleneckRows(unifiedRows, { ...filters, status: "cancelled" }, { now });
  const activeForCompare = filterJourneyBottleneckRows(unifiedRows, { ...filters, status: "active" }, { now });
  const cancellationCompare = buildCancellationCompare(activeForCompare, cancelledRows);

  const attentionAll = withAttention
    .filter((r) => r.attentionLevel !== "Normal")
    .sort((a, b) => {
      const order = { Crítico: 0, Atenção: 1, Normal: 2 };
      return (order[a.attentionLevel] ?? 9) - (order[b.attentionLevel] ?? 9);
    })
    .map((r) => ({
      clientId: r.clientId,
      clientCode: r.clientCode,
      clientName: r.clientName,
      engineer: r.engineer,
      program: r.program,
      segment: r.segment,
      tenureDays: r.tenureDays,
      completedOnboarding: r.completedOnboarding,
      daysToFirstMeeting: r.daysToFirstMeeting,
      daysSinceLastMeeting: r.daysSinceLastMeeting,
      totalMeetings: r.totalMeetings,
      hasPlan: r.hasPlan,
      hasMechanism: r.hasMechanism,
      attentionLevel: r.attentionLevel,
      attentionReasons: r.attentionReasons,
    }));

  const insightCtx = {
    population: filtered.length,
    summary,
    funnel,
    velocity,
    meetings,
    quality,
    cancellationCompare,
    rankings,
    epTable,
    overlapNoMeetingAndOpenOnboarding,
    firstMeetingOnboardingHeatmap,
  };

  const filterOptions = {
    engineers: sortLabelsUnknownLast(unifiedRows.map((r) => r.engineer || "Não informado")),
    segments: sortLabelsUnknownLast(unifiedRows.map((r) => r.segment || "Não informado")),
  };

  return {
    calculationVersion: IJB_CALCULATION_VERSION,
    generatedAt: new Date().toISOString(),
    filters: normalizeInternalJourneyBottlenecksFilters(filters),
    filterOptions,
    defaultStatusFilter: "active",
    summary,
    funnel,
    mainBottleneck: funnel.mainBottleneck,
    velocity,
    meetings,
    meetingsByType: meetingTypes?.chart || meetingTypes?.items || meetingTypes || null,
    meetingsByTypeMeta: {
      source: "Calendly",
      note: meetingTypes?.metadata?.note || "Fonte: Calendly. Demais indicadores: BASE QV.",
    },
    recencyChart: meetings.recency.chart,
    firstMeetingOnboardingHeatmap,
    firstMeetingHeatmapInsights: buildFirstMeetingHeatmapInsights(firstMeetingOnboardingHeatmap),
    rankings,
    epTable,
    attentionRules: {
      description:
        "Normal: sem sinais fortes. Atenção: onboarding incompleto, recência baixa ou marcos atrasados vs p75. Crítico: onboarding incompleto e (sem 1ª reunião ou 90+ dias sem reunião).",
      thresholds,
    },
    insights: buildJourneyBottleneckInsights(insightCtx),
    recommendations: buildJourneyRecommendations({ ...insightCtx, summary, funnel, firstMeetingOnboardingHeatmap }),
    attentionClientsAll: attentionAll,
    attentionClientRows: attentionAll,
    attentionClientsTotal: attentionAll.length,
    attentionEpAudit: {
      total: attentionAll.length,
      unknownEp: attentionAll.filter((r) => r.engineer === "Não informado").length,
      resolvedEp: attentionAll.filter((r) => r.engineer !== "Não informado").length,
      source: "clients.engenheiro_patrimonial (mesma regra de Dados Gerais / Reuniões)",
    },
    metadata: {
      ...metadata,
      sources: { default: "BASE QV", meetingTypes: "Calendly" },
      cancellationRule: "Cancelamento efetivo via mapa analítico (churn_efetivado_at, distrato, data_churn). Arquivados excluídos.",
      onboardingCompletionRule: metadata.onboardingCompletionRule,
      stalledRule:
        "Normal: sem sinais fortes. Atenção: onboarding incompleto, recência baixa ou marcos acima do p75. Crítico: onboarding incompleto e (sem 1ª reunião ou 90+ dias sem reunião).",
    },
  };
}

export async function computeInternalJourneyBottlenecksPayload(options = {}) {
  return runWithAnalyticsDataContext(async () => {
    const configError = dataConfigurationError();
    if (configError) {
      const err = new Error(configError);
      err.code = "config";
      throw err;
    }

    const filters = normalizeInternalJourneyBottlenecksFilters(options.filters || {});
    const bundle = await preloadExecutiveSharedBundle();
    const meetingTypes = await loadMeetingTypesFromCalendly().catch(() => null);

    const onboard = buildOnboardingPayload({
      clients: bundle.clients,
      calendlyRows: bundle.calendlyRows,
      manualRows: bundle.manualRows,
      attendanceRows: bundle.attendanceRows,
      implRows: bundle.implRows,
      cancellations: bundle.cancellations,
      journeys: bundle.journeys,
      financialRows: bundle.financialRows,
      mechanisms: bundle.mechanismsRaw,
      airtableIndex: bundle.airtableIndex,
    });

    const meetings = buildMeetingsPayload({
      clients: bundle.clients,
      calendlyRows: bundle.calendlyRows,
      manualRows: bundle.manualRows,
      attendanceRows: bundle.attendanceRows,
      implRows: bundle.implRows,
      cancellations: bundle.cancellations,
      airtableIndex: bundle.airtableIndex,
      meetingTypes,
    });

    const clientById = new Map(bundle.clients.map((c) => [String(c.id), c]));
    const unifiedRows = mergeClientRows(onboard.clients, meetings.clients, clientById, new Date());

    return buildInternalJourneyBottlenecksPayload({
      unifiedRows,
      filters,
      meetingTypes: meetings.meetingTypes,
      metadata: {
        onboardingCompletionRule: onboard.metadata?.completionRule,
        firstMeetingRule: onboard.metadata?.firstMeetingRule,
        planRule: onboard.metadata?.planRule,
        mechanismRule: onboard.metadata?.mechanismRule,
      },
      attentionPage: options.attentionPage,
      attentionPageSize: options.attentionPageSize,
    });
  });
}

/** Garante counts de reuniões/recência no payload público (aliases legados + cache antigo). */
export function normalizeMeetingsForPublic(meetings) {
  if (!meetings || typeof meetings !== "object") return meetings;
  const rec = { ...(meetings.recency || {}) };
  for (const threshold of [30, 60, 90]) {
    const count = pickFiniteNumber(
      rec[`count${threshold}Plus`],
      rec[`count${threshold}`],
      meetings[`count${threshold}PlusWithoutMeeting`],
    );
    const pctVal = pickFiniteNumber(rec[`pct${threshold}Plus`], meetings[`pct${threshold}PlusWithoutMeeting`]);
    if (count != null) {
      rec[`count${threshold}Plus`] = count;
      rec[`count${threshold}`] = count;
    }
    if (pctVal != null) rec[`pct${threshold}Plus`] = pctVal;
  }
  if (rec.populationN == null && meetings.populationN != null) rec.populationN = meetings.populationN;

  const fm = { ...(meetings.firstMeeting || {}) };
  const obsN = pickFiniteNumber(fm.observableCount);
  for (const suffix of ["Within7", "Within14", "Within30", "Over30"]) {
    const count = pickFiniteNumber(fm[`count${suffix}`]);
    const pctVal = pickFiniteNumber(fm[`pct${suffix}`]);
    if (count != null) fm[`count${suffix}`] = count;
    if (pctVal != null) fm[`pct${suffix}`] = pctVal;
  }
  if (obsN != null) fm.observableCount = obsN;
  if (!fm.denominatorNote) {
    fm.denominatorNote = "Percentual calculado entre clientes com tempo até primeira reunião observável.";
  }

  return {
    ...meetings,
    recency: { ...rec, chart: rec.chart ?? meetings.recency?.chart },
    firstMeeting: fm,
  };
}

export function toPublicInternalJourneyBottlenecksPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const meetings = normalizeMeetingsForPublic(payload.meetings);
  const epTable = (payload.epTable || []).map((row) => {
    const { count, pct: pctVal } = resolveEpWithoutMeetingFields(row);
    const next = { ...row };
    if (pctVal != null) {
      next.withoutMeetingPct = pctVal;
      next.semReuniaoPct = pctVal;
    }
    if (count != null) {
      next.withoutMeetingCount = count;
      next.withoutMeeting = count;
      next.semReuniaoCount = count;
    }
    return next;
  });
  const attentionClientsAll = resolveAttentionClientsAll(payload);
  return {
    ...payload,
    meetings,
    epTable,
    attentionClientsAll,
    attentionClientRows: attentionClientsAll,
    attentionClientsTotal:
      attentionClientsAll.length > 0
        ? attentionClientsAll.length
        : expectedAttentionClientsTotal(payload),
    payloadSchema: IJB_PAYLOAD_SCHEMA,
  };
}

export {
  parseInternalJourneyBottlenecksFilters,
  normalizeInternalJourneyBottlenecksFilters,
  defaultInternalJourneyBottlenecksFilters,
} from "./internal-journey-bottlenecks-filters.mjs";
