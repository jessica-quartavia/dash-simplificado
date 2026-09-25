/**
 * População canônica de renovação — Análise interna Mecanismos × Satisfação.
 * Independente de NPS/CSAT; reutiliza regras oficiais de ciclo (client-cycle-renewal.mjs).
 */
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { filterWideClients, normalizeInternalMechanismsSatisfactionFilters } from "./internal-mechanisms-satisfaction-filters.mjs";
import { splitWithWithoutMechanism } from "./internal-mechanisms-nps-focus.mjs";
import { RENEWAL_OFFICIAL_RULES } from "./internal-mechanisms-renewal-rules.mjs";
import { mechanismBand } from "./internal-mechanisms-renewal-stratified-shared.mjs";

export function filtersForRenewalPopulation(filters = {}) {
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  return {
    ...f,
    npsScore: "all",
    npsClass: "all",
  };
}

/** Carteira wide após filtros operacionais — sem recorte NPS/classe NPS. */
export function filterWideClientsForRenewalAnalysis(rows, filters = {}) {
  return filterWideClients(rows, filtersForRenewalPopulation(filters));
}

export function toCanonicalRenewalClientRow(c) {
  if (!c) return null;
  const mechanismCount = c.totalImplementedMechanisms ?? 0;
  const row = {
    clientId: c.clientId,
    clientCode: c.clientCode,
    clientName: c.clientName,
    analyticalStatus: c.analyticalStatus,
    program: c.program,
    ep: c.ep,
    segment: c.segment,
    tenureDays: c.tenureDays,
    renewed: c.renewed === true,
    renewalCount: c.renewalCount,
    currentCycle: c.currentCycle,
    cycleValid: c.cycleValid === true,
    hasMechanism: mechanismCount > 0,
    mechanismCount,
    totalImplementedMechanisms: mechanismCount,
    mechanismNames: c.implementedMechanismLabels || c.implementedMechanismNames || [],
    cycleEndDate: c.cycleEndDate,
    latestNps: c.latestNps ?? null,
  };
  for (const key of Object.keys(c)) {
    if (key.startsWith("implemented_")) row[key] = c[key];
  }
  return row;
}

export function buildCanonicalRenewalPopulation(wideClients, filters = {}) {
  const filtered = filterWideClientsForRenewalAnalysis(wideClients, filters);
  return filtered.map(toCanonicalRenewalClientRow).filter(Boolean);
}

export function summarizeRenewalPopulation(population = []) {
  const eligible = population.filter((c) => c.cycleValid);
  const renewed = eligible.filter((c) => c.renewed);
  const notRenewed = eligible.filter((c) => !c.renewed);
  const { withMechanism, withoutMechanism } = splitWithWithoutMechanism(population);
  const eligWith = withMechanism.filter((c) => c.cycleValid);
  const eligWithout = withoutMechanism.filter((c) => c.cycleValid);
  const renewedWith = eligWith.filter((c) => c.renewed);
  const renewedWithout = eligWithout.filter((c) => c.renewed);
  return {
    totalInUniverse: population.length,
    eligible: eligible.length,
    renewed: renewed.length,
    notRenewed: notRenewed.length,
    withMechanism: withMechanism.length,
    withoutMechanism: withoutMechanism.length,
    eligibleWithMechanism: eligWith.length,
    eligibleWithoutMechanism: eligWithout.length,
    renewedWithMechanism: renewedWith.length,
    renewedWithoutMechanism: renewedWithout.length,
    renewalRatePct: eligible.length
      ? Math.round((renewed.length / eligible.length) * 1000) / 10
      : null,
    officialRules: RENEWAL_OFFICIAL_RULES,
  };
}

/**
 * Confronto NPS-recorte vs população oficial de renovação (auditoria 15 vs 40).
 */
export function auditRenewedWithoutMechanismNpsVsFull(wideClients, filters, npsPopulation = []) {
  const renewalPop = buildCanonicalRenewalPopulation(wideClients, filters);
  const renewalSummary = summarizeRenewalPopulation(renewalPop);
  const npsRows = (npsPopulation || []).map(toCanonicalRenewalClientRow).filter(Boolean);
  const npsSummary = summarizeRenewalPopulation(npsRows);
  const activeRenewal = renewalPop.filter((c) =>
    matchesAnalyticalStatusFilter(c.analyticalStatus, "active"),
  );
  const activeSummary = summarizeRenewalPopulation(activeRenewal);
  return {
    metricRows: [
      {
        metric: "Renovados sem mecanismo (elegíveis)",
        population: "canonicalRenewalPopulation (filtros da página, sem NPS)",
        filters: "status/programa/EP/segmento/mecanismo; npsScore=all; npsClass=all",
        value: renewalSummary.renewedWithoutMechanism,
      },
      {
        metric: "Renovados sem mecanismo (elegíveis)",
        population: "npsPopulation (legado — com recorte NPS)",
        filters: "mesmos + exige NPS válido na população principal",
        value: npsSummary.renewedWithoutMechanism,
      },
      {
        metric: "Renovados sem mecanismo (elegíveis, ativos)",
        population: "canonicalRenewalPopulation status=ativo",
        filters: "analytical_status ativo",
        value: activeSummary.renewedWithoutMechanism,
      },
    ],
    canonical: renewalSummary,
    npsScoped: npsSummary,
    activeCanonical: activeSummary,
    explanation:
      npsSummary.renewedWithoutMechanism !== renewalSummary.renewedWithoutMechanism
        ? "O recorte NPS reduz clientes elegíveis; métricas de renovação da seção 8 passam a usar apenas canonicalRenewalPopulation."
        : "Populações coincidem neste recorte (raro quando há clientes renovados sem NPS).",
  };
}

/** Filtros para Modelo B — toda a base válida (sem recorte de status). */
export function filtersForAllClientsRenewalPopulation(filters = {}) {
  const f = normalizeInternalMechanismsSatisfactionFilters(filters);
  return {
    ...f,
    status: "all",
    npsScore: "all",
    npsClass: "all",
  };
}

/** População canônica de renovação — todos os status analíticos (Modelo B). */
export function buildCanonicalAllClientsRenewalPopulation(wideClients, filters = {}) {
  const filtered = filterWideClients(wideClients, filtersForAllClientsRenewalPopulation(filters));
  return filtered.map(toCanonicalRenewalClientRow).filter(Boolean);
}

function statusBucket(analyticalStatus) {
  const st = String(analyticalStatus || "");
  if (st === "Ativo") return "active";
  if (st === "Congelado") return "frozen";
  if (st.startsWith("Cancelado") || st === "Cancelado confirmado" || st === "Cancelado efetivado sem data") {
    return "cancelled";
  }
  if (st === "Marcado como cancelado sem confirmação") return "cancelled";
  return "other";
}

export function summarizeAllClientsRenewalPopulation(population = []) {
  const base = summarizeRenewalPopulation(population);
  const byStatus = { active: 0, cancelled: 0, frozen: 0, other: 0 };
  for (const c of population) {
    byStatus[statusBucket(c.analyticalStatus)] += 1;
  }
  return {
    ...base,
    totalClients: population.length,
    active: byStatus.active,
    cancelled: byStatus.cancelled,
    frozen: byStatus.frozen,
    other: byStatus.other,
    statusDistribution: [
      { label: "Ativos", count: byStatus.active },
      { label: "Cancelados", count: byStatus.cancelled },
      { label: "Congelados", count: byStatus.frozen },
      { label: "Outros", count: byStatus.other },
    ].filter((r) => r.count > 0),
  };
}

/** Linhas para treino estratificado (mesma regra y do Modelo A). */
export function toStratifiedTrainingPool(population = []) {
  return population
    .filter((c) => c.cycleValid && (c.renewed === true || c.renewed === false))
    .map((c) => {
      const mechanismCount = c.mechanismCount ?? c.totalImplementedMechanisms ?? 0;
      return {
        ...c,
        client_id: c.clientId,
        y: c.renewed ? 1 : 0,
        mechanismCountAtReference: mechanismCount,
        totalImplementedMechanisms: mechanismCount,
      };
    });
}

export function mechanismCountBandTableFromCanonical(population = []) {
  const bands = ["0", "1", "2", "3", "4+"];
  const eligible = population.filter((c) => c.cycleValid);
  return bands.map((band) => {
    const rows = eligible.filter((c) => mechanismBand(c.mechanismCount ?? 0) === band);
    const renewed = rows.filter((c) => c.renewed).length;
    return {
      band,
      clients: rows.length,
      renewed,
      renewalRatePct: rows.length ? Math.round((renewed / rows.length) * 1000) / 10 : null,
    };
  });
}

export function chartSplitItems(withCount, withoutCount, labels = {}) {
  const withLabel = labels.with || "Com mecanismo";
  const withoutLabel = labels.without || "Sem mecanismo";
  const total = (withCount || 0) + (withoutCount || 0) || 1;
  const pct = (n) => Math.round((n / total) * 1000) / 10;
  return [
    { label: withLabel, count: withCount || 0, percent: pct(withCount || 0) },
    { label: withoutLabel, count: withoutCount || 0, percent: pct(withoutCount || 0) },
  ].filter((i) => i.count > 0);
}
