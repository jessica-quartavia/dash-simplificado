/**
 * Filtros — Indicadores Temporais (V2).
 * Busca + Programa + Fonte + Mês + Cancelamento. Sem filtro global de período.
 */
import { matchesSearch } from "./filters/search.mjs";
import { programMatches } from "./filters/program.mjs";

export const TEMPORAL_SEARCH_FIELDS = {
  name: "name",
  code: "code",
  id: "subjectId",
};

export const TEMPORAL_SOURCE_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "BASE QV", label: "BASE QV" },
  { value: "App Pharus", label: "App Pharus" },
];

export const TEMPORAL_CANCEL_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "pre90", label: "Até 90 dias antes do cancelamento" },
  { value: "pre30", label: "Até 30 dias antes do cancelamento" },
  { value: "post", label: "Após cancelamento" },
  { value: "none", label: "Sem data de cancelamento" },
];

function averageNullable(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, v) => sum + v, 0) / nums.length) * 10) / 10;
}

function resolveFilteredLastMonthDays(monthlyRows, filters, payloadSummary) {
  if (filters.month && filters.month !== "all") {
    return averageNullable(
      monthlyRows.filter((row) => row.month === filters.month).map((row) => row.daysWithoutActivity),
    );
  }
  return payloadSummary?.lastMonthDaysWithoutActivity ?? null;
}

export function defaultTemporalIndicatorsFilters() {
  return {
    search: "",
    program: "all",
    source: "all",
    month: "all",
    cancelWindow: "all",
  };
}

export function formatTemporalMonthLabel(ym) {
  if (!ym || ym === "all") return "Todos";
  const [y, m] = String(ym).split("-");
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const idx = Number(m) - 1;
  if (!y || idx < 0 || idx > 11) return ym;
  return `${months[idx]}/${y}`;
}

export function sortTemporalMonthsDesc(months = [], nowKey = currentMonthKey()) {
  return [...new Set(months.filter(Boolean))]
    .filter((ym) => ym <= nowKey)
    .sort((a, b) => b.localeCompare(a));
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function temporalSourceMatches(source, selected = "all") {
  if (!selected || selected === "all") return true;
  return String(source || "")
    .split("+")
    .map((item) => item.trim())
    .includes(selected);
}

export function temporalCancelWindowMatches(row, cancelWindow = "all") {
  if (cancelWindow === "all") return true;
  if (cancelWindow === "none") return !row.cancellationDate;
  if (row.monthsToCancellation == null) return false;
  if (cancelWindow === "pre90") return row.monthsToCancellation >= 0 && row.monthsToCancellation <= 3;
  if (cancelWindow === "pre30") return row.monthsToCancellation === 0;
  if (cancelWindow === "post") return row.monthsToCancellation < 0;
  return true;
}

export function temporalMonthMatches(row, month = "all") {
  if (!month || month === "all") return true;
  return row.month === month;
}

export function filterTemporalSubjectRow(row, filters = {}) {
  const f = { ...defaultTemporalIndicatorsFilters(), ...filters };
  if (!programMatches(row, f.program)) return false;
  if (!temporalSourceMatches(row.source, f.source)) return false;
  if (!temporalMonthMatches(row, f.month)) return false;
  if (!temporalCancelWindowMatches(row, f.cancelWindow)) return false;
  if (!matchesSearch(row, f.search, TEMPORAL_SEARCH_FIELDS)) return false;
  return true;
}

export function filterTemporalActivityRecency(rows, filters = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const f = { ...defaultTemporalIndicatorsFilters(), ...filters };
    if (!programMatches(row, f.program)) return false;
    if (!temporalSourceMatches(row.source, f.source)) return false;
    if (f.cancelWindow === "none" && row.cancellationDate) return false;
    if (!matchesSearch(row, f.search, TEMPORAL_SEARCH_FIELDS)) return false;
    return true;
  });
}

export function filterTemporalMonthlyRows(rows, subjectIds, filters = {}) {
  const ids = subjectIds instanceof Set ? subjectIds : new Set(subjectIds || []);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!ids.has(row.subjectId)) return false;
    return filterTemporalSubjectRow(row, filters);
  });
}

export function filterTemporalPreCancellationClients(preCancellation, filters = {}, subjectIds = null) {
  const ids =
    subjectIds ||
    new Set(
      (preCancellation?.clients || [])
        .filter((row) => filterTemporalSubjectRow(row, filters))
        .map((row) => row.subjectId),
    );
  return (preCancellation?.clients || []).filter((row) => ids.has(row.subjectId));
}

export function filterTemporalActiveRiskClients(activeRisk, filters = {}, subjectIds = null) {
  const ids =
    subjectIds ||
    new Set(
      (activeRisk?.clients || [])
        .filter((row) => filterTemporalSubjectRow(row, filters))
        .map((row) => row.subjectId),
    );
  return (activeRisk?.clients || []).filter((row) => ids.has(row.subjectId));
}

function pct(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function buildTemporalSubjectMeta(payload = {}) {
  return new Map((payload.activityRecency || []).map((row) => [row.subjectId, row]));
}

function hydrateTemporalRow(row, subjectMeta) {
  if (!row || typeof row !== "object") return row;
  if (row.name != null && row.code != null) return row;
  const meta = subjectMeta?.get(row.subjectId);
  return meta ? { ...meta, ...row } : row;
}

function signalKeyFromLabel(label, catalog = []) {
  const match = catalog.find((item) => item.label === label);
  return match?.key || label;
}

export function recomputePreCancellationSignals(preClients, catalog = [], analyzedTotal = 0) {
  const counts = new Map((catalog || []).map((item) => [item.key, 0]));
  for (const client of preClients || []) {
    const seen = new Set();
    for (const label of client.signals || []) {
      const key = signalKeyFromLabel(label, catalog);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return (catalog || []).map((item) => ({
    ...item,
    count: counts.get(item.key) || 0,
    percent: pct(counts.get(item.key) || 0, analyzedTotal),
  }));
}

export function recomputeActiveRiskSignals(activeClients, catalog = [], analyzedTotal = 0) {
  const counts = new Map((catalog || []).map((item) => [item.key, 0]));
  for (const client of activeClients || []) {
    const seen = new Set();
    for (const label of client.signals || []) {
      const key = signalKeyFromLabel(label, catalog);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return (catalog || [])
    .map((item) => ({
      ...item,
      count: counts.get(item.key) || 0,
      percent: pct(counts.get(item.key) || 0, analyzedTotal),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

/** Faixas V1: clientes ativos com sinais (1/2/3/4+). Sem bucket 0 — população = clientes com sinal. */
export function buildActiveRiskSignalCountDistribution(clients = []) {
  const buckets = new Map();
  for (const row of clients) {
    const count = Number(row.signalCount ?? (row.signals || []).length ?? 0);
    if (count <= 0) continue;
    const label = count >= 4 ? "4 ou mais sinais" : `${count} ${count === 1 ? "sinal" : "sinais"}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  const order = ["1 sinal", "2 sinais", "3 sinais", "4 ou mais sinais"];
  const total = clients.length || 0;
  return order.map((label) => ({
    label,
    count: buckets.get(label) || 0,
    percent: total ? Math.round(((buckets.get(label) || 0) / total) * 1000) / 10 : 0,
  }));
}

export function needsTemporalClientRows(filters = {}) {
  const f = { ...defaultTemporalIndicatorsFilters(), ...filters };
  return f.month !== "all" || f.cancelWindow !== "all" || f.source !== "all" || f.program !== "all";
}

export function summarizeFilteredTemporal(payload = {}, filters = {}) {
  const f = { ...defaultTemporalIndicatorsFilters(), ...filters };
  const clientsAvailable = Array.isArray(payload.clients) && payload.clients.length > 0;
  if (!clientsAvailable && !needsTemporalClientRows(f) && payload.summary) {
    const recency = filterTemporalActivityRecency(payload.activityRecency || [], f);
    const preClients = filterTemporalPreCancellationClients(payload.preCancellation, f);
    const preAnalyzed = recency.filter((row) => row.cancellationDate).length;
    const preSignals = recomputePreCancellationSignals(preClients, payload.preCancellation?.signals || [], preAnalyzed);
    const activeClients = filterTemporalActiveRiskClients(payload.activeRisk, f);
    const activeAnalyzed = recency.filter((row) => {
      const status = String(row.status || "").toLowerCase();
      return !row.cancellationDate && status === "ativo";
    }).length;
    const activeSignals = recomputeActiveRiskSignals(activeClients, payload.activeRisk?.signals || [], activeAnalyzed);
    return {
      recency,
      monthlyRows: [],
      summary: {
        totalSubjects: recency.length,
        baseClients: payload.summary?.baseClients ?? recency.filter((row) => String(row.source || "").includes("BASE QV")).length,
        appPharusUsers: payload.summary?.appPharusUsers ?? recency.filter((row) => String(row.source || "").includes("App Pharus")).length,
        totalLogins: payload.summary.totalLogins ?? 0,
        totalMeetings: payload.summary.totalMeetings ?? 0,
        totalImplementations: payload.summary.totalImplementations ?? 0,
        totalImplementations: payload.summary.totalImplementations ?? 0,
        totalFinancialUpdates: payload.summary.totalFinancialUpdates ?? 0,
        totalNpsResponses: payload.summary.totalNpsResponses ?? 0,
        lastMonthDaysWithoutActivity: payload.summary.lastMonthDaysWithoutActivity ?? null,
        loginEventsSource: payload.summary.loginEventsSource ?? null,
        crossSource: payload.summary.crossSource ?? null,
        preCancellationClientsWithSignals: preClients.length,
        preCancellationClientsWithSignalsPercent: pct(preClients.length, preAnalyzed),
        activeClientsWithSignals: activeClients.length,
        activeClientsWithSignalsPercent: pct(activeClients.length, activeAnalyzed),
      },
      preCancellation: {
        ...(payload.preCancellation || {}),
        analyzedCancelledClients: preAnalyzed,
        clientsWithSignals: preClients.length,
        clientsWithSignalsPercent: pct(preClients.length, preAnalyzed),
        signals: preSignals,
        clients: preClients,
      },
      activeRisk: {
        ...(payload.activeRisk || {}),
        analyzedActiveClients: activeAnalyzed,
        clientsWithSignals: activeClients.length,
        clientsWithSignalsPercent: pct(activeClients.length, activeAnalyzed),
        signals: activeSignals,
        clients: activeClients,
        signalCountDistribution: buildActiveRiskSignalCountDistribution(activeClients),
      },
    };
  }

  const subjectMeta = buildTemporalSubjectMeta(payload);
  const monthlyAll = (payload.clients || []).map((row) => hydrateTemporalRow(row, subjectMeta));
  const monthlyFiltered = monthlyAll.filter((row) => filterTemporalSubjectRow(row, filters));
  const subjectIds = new Set(monthlyFiltered.map((row) => row.subjectId));
  const recency = filterTemporalActivityRecency(payload.activityRecency || [], filters).filter((row) =>
    subjectIds.has(row.subjectId),
  );
  const monthlyRows = filterTemporalMonthlyRows(monthlyAll, subjectIds, filters);

  const preClients = filterTemporalPreCancellationClients(
    payload.preCancellation
      ? {
          ...payload.preCancellation,
          clients: (payload.preCancellation.clients || []).map((row) => hydrateTemporalRow(row, subjectMeta)),
        }
      : payload.preCancellation,
    filters,
    subjectIds,
  );
  const preAnalyzed = recency.filter((row) => row.cancellationDate).length;
  const preSignals = recomputePreCancellationSignals(preClients, payload.preCancellation?.signals || [], preAnalyzed);

  const activeClients = filterTemporalActiveRiskClients(
    payload.activeRisk
      ? {
          ...payload.activeRisk,
          clients: (payload.activeRisk.clients || []).map((row) => hydrateTemporalRow(row, subjectMeta)),
        }
      : payload.activeRisk,
    filters,
    subjectIds,
  );
  const activeAnalyzed = recency.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return !row.cancellationDate && status === "ativo";
  }).length;
  const activeSignals = recomputeActiveRiskSignals(activeClients, payload.activeRisk?.signals || [], activeAnalyzed);

  return {
    recency,
    monthlyRows,
    summary: {
      totalSubjects: recency.length,
      baseClients: recency.filter((row) => String(row.source || "").includes("BASE QV")).length,
      appPharusUsers: recency.filter((row) => String(row.source || "").includes("App Pharus")).length,
      totalLogins: monthlyRows.reduce((sum, row) => sum + (Number(row.logins) || 0), 0),
      totalMeetings: monthlyRows.reduce((sum, row) => sum + (Number(row.meetings) || 0), 0),
      totalImplementations: monthlyRows.reduce((sum, row) => sum + (Number(row.implementations) || 0), 0),
      totalFinancialUpdates: monthlyRows.reduce((sum, row) => sum + (Number(row.financialUpdates) || 0), 0),
      totalNpsResponses: monthlyRows.reduce((sum, row) => sum + (Number(row.npsResponses) || 0), 0),
      lastMonthDaysWithoutActivity: resolveFilteredLastMonthDays(monthlyRows, f, payload.summary),
      loginEventsSource: payload.summary?.loginEventsSource ?? null,
      crossSource: payload.summary?.crossSource ?? null,
      preCancellationClientsWithSignals: preClients.length,
      preCancellationClientsWithSignalsPercent: pct(preClients.length, preAnalyzed),
      activeClientsWithSignals: activeClients.length,
      activeClientsWithSignalsPercent: pct(activeClients.length, activeAnalyzed),
    },
    preCancellation: {
      ...(payload.preCancellation || {}),
      analyzedCancelledClients: preAnalyzed,
      clientsWithSignals: preClients.length,
      clientsWithSignalsPercent: pct(preClients.length, preAnalyzed),
      signals: preSignals,
      clients: preClients,
    },
    activeRisk: {
      ...(payload.activeRisk || {}),
      analyzedActiveClients: activeAnalyzed,
      clientsWithSignals: activeClients.length,
      clientsWithSignalsPercent: pct(activeClients.length, activeAnalyzed),
      signals: activeSignals,
      clients: activeClients,
      signalCountDistribution: buildActiveRiskSignalCountDistribution(activeClients),
    },
  };
}

export function buildPreCancellationInsights(preCancellation = {}) {
  if (Array.isArray(preCancellation.insights) && preCancellation.insights.length) {
    return preCancellation.insights;
  }

  const insights = [];
  const signals = [...(preCancellation.signals || [])].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  const windows = preCancellation.windowSummary || [];
  const analyzed = preCancellation.analyzedCancelledClients || 0;

  const top = signals.find((item) => item.count > 0);
  if (top) {
    insights.push(
      `${top.label} é mais frequente entre cancelados analisados (${top.percent}% dos ${analyzed || "—"} casos) — sinal para monitoramento, sem inferência causal.`,
    );
  }

  const last30 = windows.find((item) => item.key === "last30");
  const baseline = windows.find((item) => item.key === "baseline");
  if (last30 && baseline) {
    const baselineMonths = 4;
    const baselineLoginsAvg = baselineMonths ? (baseline.logins || 0) / baselineMonths : 0;
    const last30Logins = last30.logins || 0;
    if (baselineLoginsAvg > 0 && last30Logins <= baselineLoginsAvg * 0.7) {
      insights.push(
        `Queda de logins nos 30 dias antes do cancelamento está associada ao recorte (${last30Logins.toLocaleString("pt-BR")} logins vs média de ${Math.round(baselineLoginsAvg).toLocaleString("pt-BR")} no baseline de 91–180 dias).`,
      );
    }
    if ((baseline.meetings || 0) > 0 && (last30.meetings || 0) < (baseline.meetings || 0) / baselineMonths * 0.6) {
      insights.push(
        `Menor volume de reuniões no mês imediatamente anterior ao cancelamento está associado ao padrão observado entre cancelados (comparado ao baseline 91–180 dias).`,
      );
    }
    if ((baseline.financialUpdates || 0) > 0 && (last30.financialUpdates || 0) === 0) {
      insights.push(
        `Ausência de atualização financeira no mês anterior ao cancelamento é mais frequente entre cancelados analisados do que no baseline distante.`,
      );
    }
  }

  const secondary = signals.filter((item) => item.count > 0 && item.key !== top?.key).slice(0, 2);
  for (const item of secondary) {
    insights.push(
      `${item.label} aparece associado a ${item.percent}% dos cancelados analisados — útil como sinal complementar de monitoramento.`,
    );
  }

  if (!insights.length && analyzed > 0) {
    insights.push(
      `Nenhum sinal pré-cancelamento dominante no recorte filtrado (${analyzed} cancelados analisados). Associações permanecem descritivas, não causais.`,
    );
  }

  return insights.slice(0, 5);
}

export function sortTemporalActivityRecency(rows, sortKey = "name", sortDir = "asc") {
  const list = [...(rows || [])];
  list.sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });
  return list;
}

export function temporalMonthSelectOptions(payload = {}, selected = "all") {
  const months = sortTemporalMonthsDesc(payload.months || []);
  return [
    { value: "all", label: "Todos" },
    ...months.map((ym) => ({ value: ym, label: formatTemporalMonthLabel(ym) })),
  ].map((opt) => ({ ...opt, selected: opt.value === selected }));
}
