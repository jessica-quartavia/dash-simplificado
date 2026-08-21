/**
 * Métricas de Implementação de Mecanismos (V2).
 *
 * CSV Dash Kids (Página1 (1) — Implementação de Mecanismos):
 * Sim: clientes BASE QV, tipos, tipos sem uso, mais utilizado, implementados,
 *      em andamento, % implementado, implementação recente, status dos vínculos,
 *      qtd por cliente, cobertura catálogo, utilização por tipo, impl. por mês,
 *      implementados por segmento, clientes implementados por EP.
 * Não Levar: tempo médio até 1ª impl. | gráfico tempo até 1ª | gráfico dias desde última.
 * Avaliar: nenhum.
 */
import { blankToNull, parseDate } from "./meeting-metrics.mjs";
import { coverageOf } from "./onboarding-metrics.mjs";
import {
  isBaseQvImplementedRawStatus,
  isPharusImplementedRawStatus,
  normalizeBaseQvMechanismStatus,
} from "./mechanisms/mechanism-status.mjs";
import { sortUnknownLast } from "./filters/sort-categories.mjs";

export const MECH_STATUS_ORDER = ["Apto", "Em andamento", "Implementado", "Não informado"];
export const MECH_STATUS_DISPLAY_ORDER = ["Em andamento", "Implementado", "Não informado"];
export const COUNT_BANDS = ["1", "2", "3", "4", "5 ou mais"];
export const PCT_RANGES = ["0%", "De 1% a 25%", "De 26% a 50%", "De 51% a 75%", "De 76% a 99%", "100%", "Sem recomendações"];
export const SEGMENT_ORDER = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", "Dados insuficientes"];
export const MECHANISMS_HIDDEN = [
  "averageDaysToFirstImplementation",
  "daysToFirstImplementationChart",
  "daysSinceLastImplementationChart",
];

export function foldToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalização BASE QV — ver mechanism-status.mjs para App Pharus. */
export function normalizeMechanismStatus(rawStatus) {
  return normalizeBaseQvMechanismStatus(rawStatus);
}

/** Auditoria SQL BASE QV: distinct client_id e concluido. */
export function computeBaseQvMechanismAudit(cmRows = []) {
  const { rows: deduped } = dedupeClientMechanisms(
    (Array.isArray(cmRows) ? cmRows : []).filter((row) => blankToNull(row.client_id)),
  );
  const clientsWithMechanisms = new Set();
  const clientsWithImplementedMechanism = new Set();
  let links = 0;
  let implementedLinks = 0;
  const types = new Set();
  for (const row of deduped) {
    const clientId = String(row.client_id);
    clientsWithMechanisms.add(clientId);
    links += 1;
    if (blankToNull(row.mecanismo_id)) types.add(String(row.mecanismo_id));
    if (isBaseQvImplementedRawStatus(row.status)) {
      clientsWithImplementedMechanism.add(clientId);
      implementedLinks += 1;
    }
  }
  return {
    clientsWithMechanisms: clientsWithMechanisms.size,
    clientsWithImplementedMechanism: clientsWithImplementedMechanism.size,
    links,
    implementedLinks,
    mechanismTypes: types.size,
  };
}

/** Diagnóstico App Pharus a partir de vínculos brutos. */
export function computePharusMechanismAudit(rows = []) {
  const clientsWithMechanisms = new Set();
  const clientsWithImplementedMechanism = new Set();
  const types = new Set();
  let links = 0;
  let implementedLinks = 0;
  for (const row of rows || []) {
    const userId = String(row.userId || row.user_id || "");
    if (!userId) continue;
    links += 1;
    clientsWithMechanisms.add(userId);
    const mechanismKey = String(row.mechanismId || row.mechanism_id || row.mechanismName || row.name || "");
    if (mechanismKey) types.add(mechanismKey);
    if (isPharusImplementedRawStatus(row.status)) {
      clientsWithImplementedMechanism.add(userId);
      implementedLinks += 1;
    }
  }
  return {
    clientsWithMechanisms: clientsWithMechanisms.size,
    clientsWithImplementedMechanism: clientsWithImplementedMechanism.size,
    links,
    implementedLinks,
    mechanismTypes: types.size,
  };
}

export function dedupeClientMechanisms(rows) {
  const best = new Map();
  let duplicatePairs = 0;
  for (const row of rows || []) {
    const clientId = blankToNull(row.client_id);
    const mechanismId = blankToNull(row.mecanismo_id);
    if (!clientId || !mechanismId) continue;
    const key = `${clientId}|${mechanismId}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, row);
      continue;
    }
    duplicatePairs += 1;
    const aCreated = parseDate(row.created_at)?.getTime() || 0;
    const bCreated = parseDate(current.created_at)?.getTime() || 0;
    if (aCreated > bCreated) {
      best.set(key, row);
      continue;
    }
    if (aCreated < bCreated) continue;
    const aImpl = parseDate(row.implemented_at)?.getTime() || 0;
    const bImpl = parseDate(current.implemented_at)?.getTime() || 0;
    if (aImpl > bImpl) {
      best.set(key, row);
      continue;
    }
    if (aImpl < bImpl) continue;
    if (String(row.id || "") > String(current.id || "")) best.set(key, row);
  }
  return { rows: [...best.values()], duplicatePairs };
}

export function recommendationsPerClientBand(count) {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "3";
  if (count === 4) return "4";
  return "5 ou mais";
}

export function pctBand(value, available) {
  if (!available) return "Sem recomendações";
  if (value == null) return "Sem recomendações";
  if (value <= 0) return "0%";
  if (value < 26) return "De 1% a 25%";
  if (value < 51) return "De 26% a 50%";
  if (value < 76) return "De 51% a 75%";
  if (value < 100) return "De 76% a 99%";
  return "100%";
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function distributionOrdered(items, keyFn, orderedLabels) {
  const counts = new Map(orderedLabels.map((label) => [label, 0]));
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = items.length || 1;
  return orderedLabels.map((label) => ({
    label,
    count: counts.get(label) || 0,
    percent: Math.round(((counts.get(label) || 0) / total) * 1000) / 10,
  }));
}

export function recomputeClientMechanismRollups(row, mechanisms, now = new Date()) {
  const recentCutoff = new Date(now.getTime() - 30 * 86400000);
  let eligible = 0;
  let inProgress = 0;
  let implemented = 0;
  let recentImpls = 0;
  for (const link of mechanisms || []) {
    if (link.status === "Apto") eligible += 1;
    if (link.status === "Em andamento") inProgress += 1;
    if (link.status === "Implementado") implemented += 1;
    const impl = parseDate(link.implementedAt);
    if (link.status === "Implementado" && impl && impl >= recentCutoff) recentImpls += 1;
  }
  const available = mechanisms.length;
  const implementationPercent = available > 0
    ? Math.min(100, Math.round((implemented / available) * 1000) / 10)
    : null;
  return {
    ...row,
    available,
    eligible,
    inProgress,
    implemented,
    implementationPercent,
    hasImplementationLast30Days: recentImpls > 0,
    mechanismsCountBand: recommendationsPerClientBand(available),
    percentRange: pctBand(implementationPercent, available),
    mechanisms,
  };
}

function clientKey(row) {
  return String(row.canonicalClientId || row.clientId || "");
}

function linkKey(row, mechanism) {
  return `${clientKey(row)}|${mechanism.mechanismId || mechanism.name}`;
}

function rowHasImplementedMechanism(row) {
  return (row.mechanisms || []).some((m) => m.status === "Implementado");
}

function rowHasLinkedMechanism(row) {
  return (row.mechanisms || []).length > 0 || (row.available || 0) > 0;
}

function isAppPharusClientRow(row) {
  const id = String(row?.clientId || row?.canonicalClientId || "");
  return id.startsWith("pharus:");
}

/** Soma bruta por fonte no recorte filtrado (aggregationMode = source_sum). */
export function accumulateMechanismSourceSum(list = []) {
  const baseClientsLinked = new Set();
  const appUsersLinked = new Set();
  const baseClientsImplemented = new Set();
  const appUsersImplemented = new Set();
  let baseLinksTotal = 0;
  let appLinksTotal = 0;
  let baseLinksImplemented = 0;
  let appLinksImplemented = 0;
  let baseInProgress = 0;
  let appInProgress = 0;

  for (const row of list) {
    const clientId = String(row.clientId || row.canonicalClientId || "");
    const isPharusRow = clientId.startsWith("pharus:");
    const defaultPharusUid = isPharusRow ? clientId.replace(/^pharus:/, "") : String(row.pharusUserId || "").trim() || null;

    for (const m of row.mechanisms || []) {
      const sources = m.sources || [];
      const hasBase = linkHasBaseQvSource(sources) || (!linkHasAppPharusSource(sources) && !isPharusRow);
      const hasApp = linkHasAppPharusSource(sources) || isPharusRow;
      const appUid = String(m.pharusUserId || defaultPharusUid || "").trim() || null;

      if (hasBase && !isPharusRow) {
        baseLinksTotal += 1;
        baseClientsLinked.add(clientId);
        if (m.status === "Implementado") {
          baseLinksImplemented += 1;
          baseClientsImplemented.add(clientId);
        } else if (m.status === "Em andamento") {
          baseInProgress += 1;
        }
      }
      if (hasApp && appUid) {
        appLinksTotal += 1;
        appUsersLinked.add(appUid);
        if (m.status === "Implementado") {
          appLinksImplemented += 1;
          appUsersImplemented.add(appUid);
        } else if (m.status === "Em andamento") {
          appInProgress += 1;
        }
      }
    }
  }

  const baseQvDisplayed = baseClientsLinked.size;
  const appPharusDisplayed = appUsersLinked.size;
  const displayedCombinedTotal = baseQvDisplayed + appPharusDisplayed;
  const clientsWithLinkedMechanisms = displayedCombinedTotal;
  const clientsWithImplementedMechanism = baseClientsImplemented.size + appUsersImplemented.size;
  const mechanismImplementationRate = clientsWithLinkedMechanisms
    ? Math.min(100, Math.round((clientsWithImplementedMechanism / clientsWithLinkedMechanisms) * 1000) / 10)
    : null;

  return {
    aggregationMode: "source_sum",
    baseQvDisplayed,
    appPharusDisplayed,
    displayedCombinedTotal,
    baseQvClientsWithMechanisms: baseQvDisplayed,
    appPharusUsersWithMechanisms: appPharusDisplayed,
    baseQvClientsImplemented: baseClientsImplemented.size,
    appPharusUsersImplemented: appUsersImplemented.size,
    baseQvLinksTotal: baseLinksTotal,
    appPharusLinksTotal: appLinksTotal,
    baseQvLinksImplemented: baseLinksImplemented,
    appPharusLinksImplemented: appLinksImplemented,
    baseQvInProgress: baseInProgress,
    appPharusInProgress: appInProgress,
    clientsWithLinkedMechanisms,
    clientsWithImplementedMechanism,
    mechanismImplementationRate,
    availableMechanisms: baseLinksTotal + appLinksTotal,
    implementedMechanisms: baseLinksImplemented + appLinksImplemented,
    inProgressMechanisms: baseInProgress + appInProgress,
    displayedClients: displayedCombinedTotal,
    displayedImplementedClients: clientsWithImplementedMechanism,
    displayedImplementationRate: mechanismImplementationRate,
  };
}

/** @deprecated use accumulateMechanismSourceSum */
export function countMechanismSourceDisplayRows(list = []) {
  const sum = accumulateMechanismSourceSum(list);
  return {
    baseQvDisplayed: sum.baseQvDisplayed,
    appPharusDisplayed: sum.appPharusDisplayed,
    displayedCombinedTotal: sum.displayedCombinedTotal,
  };
}

export function mechanismDataOriginLabel(hasBaseQv, hasAppPharus) {
  if (hasBaseQv && hasAppPharus) return "BASE QV + App Pharus";
  if (hasBaseQv) return "BASE QV";
  if (hasAppPharus) return "App Pharus";
  return "Não informado";
}

function linkHasBaseQvSource(sources = []) {
  return (sources || []).some((s) => /base\s*qv|base_qv/i.test(String(s)));
}

function linkHasAppPharusSource(sources = []) {
  return (sources || []).some((s) => /app\s*pharus|app_pharus/i.test(String(s)));
}

export function summarizeMechanismRows(
  rows,
  {
    sourceRows = null,
    catalog = [],
    portfolio = [],
    portfolioCount = 0,
    consolidationQuality = null,
    filters = null,
    pharusAvailable = true,
  } = {},
) {
  const list = Array.isArray(rows) ? rows : [];
  const metricsList = Array.isArray(sourceRows) ? sourceRows : list;
  const clientAudit = consolidationQuality?.clients || {};
  const links = list.flatMap((row) => (row.mechanisms || []).map((m) => ({ row, m })));
  const metricsLinks = metricsList.flatMap((row) => (row.mechanisms || []).map((m) => ({ row, m })));
  const clientsWithMechanismsRows = list.filter((row) => rowHasLinkedMechanism(row)).length;
  const rawSourceSum = accumulateMechanismSourceSum(metricsList);
  const sourceSum = pharusAvailable
    ? rawSourceSum
    : {
        ...rawSourceSum,
        appPharusDisplayed: 0,
        appPharusUsersWithMechanisms: 0,
        appPharusUsersImplemented: 0,
        appPharusLinksTotal: 0,
        appPharusLinksImplemented: 0,
        appPharusInProgress: 0,
        displayedCombinedTotal: rawSourceSum.baseQvDisplayed,
        displayedClients: rawSourceSum.baseQvDisplayed,
        clientsWithLinkedMechanisms: rawSourceSum.baseQvDisplayed,
        clientsWithImplementedMechanism: rawSourceSum.baseQvClientsImplemented,
        displayedImplementedClients: rawSourceSum.baseQvClientsImplemented,
        availableMechanisms: rawSourceSum.baseQvLinksTotal,
        implementedMechanisms: rawSourceSum.baseQvLinksImplemented,
        inProgressMechanisms: rawSourceSum.baseQvInProgress,
        mechanismImplementationRate: rawSourceSum.baseQvDisplayed
          ? Math.min(
              100,
              Math.round((rawSourceSum.baseQvClientsImplemented / rawSourceSum.baseQvDisplayed) * 1000) / 10,
            )
          : null,
        displayedImplementationRate: rawSourceSum.baseQvDisplayed
          ? Math.min(
              100,
              Math.round((rawSourceSum.baseQvClientsImplemented / rawSourceSum.baseQvDisplayed) * 1000) / 10,
            )
          : null,
      };
  const {
    baseQvDisplayed,
    appPharusDisplayed,
    displayedCombinedTotal,
    clientsWithImplementedMechanism,
    clientsWithLinkedMechanisms,
    mechanismImplementationRate,
    availableMechanisms,
    implementedMechanisms,
    inProgressMechanisms,
    aggregationMode,
    baseQvClientsImplemented,
    appPharusUsersImplemented,
    baseQvLinksImplemented,
    appPharusLinksImplemented,
    baseQvInProgress,
    appPharusInProgress,
    displayedClients,
    displayedImplementedClients,
    displayedImplementationRate,
  } = sourceSum;
  const deduplicatedUniquePeople = clientAudit.consolidatedUniquePeople ?? clientAudit.consolidated ?? null;
  const consolidationMode = clientAudit.consolidationMode || null;

  const recent = list.filter((row) => row.hasImplementationLast30Days).length;
  const usedTypeIds = new Set();
  const typeMap = new Map();
  const byName = new Map();

  for (const { row, m } of metricsLinks) {
    const key = m.mechanismId || m.name;
    const clientId = String(row.clientId || row.canonicalClientId || "");
    const isPharusRow = clientId.startsWith("pharus:");
    const defaultPharusUid = isPharusRow ? clientId.replace(/^pharus:/, "") : String(row.pharusUserId || "").trim() || null;
    const sources = m.sources || [];
    const hasBase = linkHasBaseQvSource(sources) || (!linkHasAppPharusSource(sources) && !isPharusRow);
    const hasApp = linkHasAppPharusSource(sources) || isPharusRow;
    const appUid = String(m.pharusUserId || defaultPharusUid || "").trim() || null;

    const cur = typeMap.get(key) || {
      label: m.name || "Não informado",
      mechanismId: m.mechanismId,
      baseClients: new Set(),
      appUsers: new Set(),
      baseImplementedClients: new Set(),
      appImplementedClients: new Set(),
      baseLinks: 0,
      appLinks: 0,
      hasBaseQv: false,
      hasAppPharus: false,
    };

    if (hasBase && !isPharusRow) {
      cur.hasBaseQv = true;
      cur.baseLinks += 1;
      cur.baseClients.add(clientId);
      if (m.status === "Implementado") cur.baseImplementedClients.add(clientId);
    }
    if (hasApp && appUid) {
      cur.hasAppPharus = true;
      cur.appLinks += 1;
      cur.appUsers.add(appUid);
      if (m.status === "Implementado") cur.appImplementedClients.add(appUid);
    }
    typeMap.set(key, cur);

    if (hasBase || hasApp) {
      usedTypeIds.add(String(key));
      const rank = byName.get(key) || { name: m.name, mechanismId: m.mechanismId, baseClients: new Set(), appUsers: new Set() };
      if (hasBase && !isPharusRow) rank.baseClients.add(clientId);
      if (hasApp && appUid) rank.appUsers.add(appUid);
      byName.set(key, rank);
    }
  }

  const catalogIds = new Set((catalog || []).map((item) => String(item.id)));
  const typesUsed = catalogIds.size
    ? [...catalogIds].filter((id) => {
        const item = typeMap.get(id);
        return item && (item.baseClients.size > 0 || item.appUsers.size > 0);
      }).length
    : [...usedTypeIds].length;
  const typesUnused = Math.max(0, (catalog || []).length - typesUsed);

  const ranked = [...byName.values()]
    .map((item) => ({
      ...item,
      clients: item.baseClients.size + item.appUsers.size,
    }))
    .sort((a, b) => b.clients - a.clients || String(a.name).localeCompare(String(b.name), "pt-BR"));
  const top = ranked[0] || null;
  const denom = Number(portfolioCount) || 0;
  const coverage = coverageOf(list.length, denom);

  const typeUsage = sortUnknownLast(
    [...typeMap.values()].map((item) => {
      const linkedCount = item.baseClients.size + item.appUsers.size;
      const implementedCount = item.baseImplementedClients.size + item.appImplementedClients.size;
      const dataOrigin = mechanismDataOriginLabel(item.hasBaseQv, item.hasAppPharus);
      return {
        label: item.label,
        count: linkedCount,
        linkedCount,
        implementedCount,
        linkCount: item.baseLinks + item.appLinks,
        baseLinkedCount: item.baseClients.size,
        appLinkedCount: item.appUsers.size,
        baseImplementedCount: item.baseImplementedClients.size,
        appImplementedCount: item.appImplementedClients.size,
        unit: "clientes distintos",
        dataOrigin,
        hasBaseQv: item.hasBaseQv,
        hasAppPharus: item.hasAppPharus,
        implementationPercent: linkedCount
          ? Math.round((implementedCount / linkedCount) * 1000) / 10
          : 0,
        percent: displayedCombinedTotal
          ? Math.round((linkedCount / displayedCombinedTotal) * 1000) / 10
          : 0,
      };
    }),
    (item) => item.label,
    (a, b) => b.linkedCount - a.linkedCount || String(a.label).localeCompare(String(b.label), "pt-BR"),
  );

  const monthMap = new Map();
  for (const { m } of links) {
    if (m.status !== "Implementado" || !m.implementedMonth) continue;
    monthMap.set(m.implementedMonth, (monthMap.get(m.implementedMonth) || 0) + 1);
  }
  const months = [...monthMap.keys()].sort().slice(-12).map((label) => ({
    label,
    count: monthMap.get(label) || 0,
    percent: implementedMechanisms ? Math.round(((monthMap.get(label) || 0) / implementedMechanisms) * 1000) / 10 : 0,
  }));

  const segMap = new Map(SEGMENT_ORDER.map((seg) => [seg, { label: seg, count: 0 }]));
  for (const row of list) {
    if (!rowHasImplementedMechanism(row)) continue;
    const seg = SEGMENT_ORDER.includes(row.segment) ? row.segment : "Dados insuficientes";
    segMap.get(seg).count += 1;
  }
  const bySegment = SEGMENT_ORDER.map((seg) => {
    const item = segMap.get(seg);
    return {
      label: seg,
      count: item.count,
      percent: clientsWithImplementedMechanism
        ? Math.round((item.count / clientsWithImplementedMechanism) * 1000) / 10
        : 0,
    };
  }).filter((item) => item.count > 0);

  const implementationPercentClients = mechanismImplementationRate;
  const implementationPercentLinks = availableMechanisms
    ? Math.min(100, Math.round((implementedMechanisms / availableMechanisms) * 1000) / 10)
    : null;

  return {
    aggregationMode,
    clientsWithMechanisms: displayedCombinedTotal,
    clientsWithMechanismsRows,
    baseQvDisplayed,
    appPharusDisplayed,
    displayedCombinedTotal,
    displayedClients,
    displayedImplementedClients,
    displayedImplementationRate,
    baseQvClientsWithMechanisms: baseQvDisplayed,
    appPharusUsersWithMechanisms: appPharusDisplayed,
    baseQvClientsImplemented,
    appPharusUsersImplemented,
    baseQvLinksImplemented,
    appPharusLinksImplemented,
    baseQvInProgress,
    appPharusInProgress,
    deduplicatedUniquePeople,
    consolidationMode,
    clientsWithImplementedMechanism,
    clientsWithLinkedMechanisms,
    activeClientsWithImplemented: clientsWithImplementedMechanism,
    activeClientTotal: clientsWithLinkedMechanisms,
    mechanismImplementationRate,
    availableMechanisms,
    implementedMechanisms,
    inProgressMechanisms,
    implementationPercent: mechanismImplementationRate,
    implementationPercentClients,
    implementationPercentLinks,
    typesUsed,
    typesUnused,
    catalogSize: (catalog || []).length,
    catalogCoveragePercent: (catalog || []).length
      ? Math.round((Math.min(typesUsed, catalog.length) / catalog.length) * 1000) / 10
      : null,
    topMechanismName: top?.name || "—",
    topMechanismClients: top?.clients || 0,
    recentClients: recent,
    coverage,
    statusDist: distributionOrdered(links.map(({ m }) => m), (m) => m.status, MECH_STATUS_DISPLAY_ORDER),
    countDist: distributionOrdered(
      list.filter((row) => row.available > 0),
      (row) => recommendationsPerClientBand(row.available),
      COUNT_BANDS,
    ),
    catalogDist: [
      { label: "Tipos utilizados", count: typesUsed, percent: (catalog || []).length ? Math.round((typesUsed / catalog.length) * 1000) / 10 : 0 },
      { label: "Tipos sem utilização", count: typesUnused, percent: (catalog || []).length ? Math.round((typesUnused / catalog.length) * 1000) / 10 : 0 },
    ],
    typeUsage,
    months,
    bySegment,
  };
}

export function summarizeEngineerBars(rows, portfolio, { limit = 12 } = {}) {
  const totals = new Map();
  for (const item of portfolio || []) {
    const eng = item.engineer || "Não informado";
    totals.set(eng, (totals.get(eng) || 0) + (Number(item.count) || 1));
  }
  const impl = new Map();
  for (const row of rows || []) {
    if (!rowHasImplementedMechanism(row)) continue;
    const eng = row.engineer || "Não informado";
    impl.set(eng, (impl.get(eng) || 0) + 1);
  }
  return [...totals.entries()]
    .map(([label, total]) => {
      const count = impl.get(label) || 0;
      return {
        label,
        count,
        percent: total ? Math.round((count / total) * 1000) / 10 : 0,
        total,
      };
    })
    .sort((a, b) => b.percent - a.percent || b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, limit);
}

export { monthKey };
