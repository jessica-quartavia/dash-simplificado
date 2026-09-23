/**
 * Análise NPS-first — população = clientes com nota NPS válida (latest dedupe oficial).
 */
import { computeNpsBreakdown } from "./nps-metrics.mjs";
import {
  associationStrength,
  chiSquareIndependence,
  coveragePct,
  mannWhitney,
  mean,
  median,
  pointBiserial,
  round3,
  round4,
  spearman,
} from "./stats-tests.mjs";

export const IMS_MECHANISM_MIN_N = 30;

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function round1(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}

export function selectNpsPopulation(wideClients = []) {
  return wideClients.filter((c) => c.latestNps != null && Number.isFinite(Number(c.latestNps)));
}

export function splitWithWithoutMechanism(npsPopulation = []) {
  const withMechanism = npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  const withoutMechanism = npsPopulation.filter((c) => !(c.totalImplementedMechanisms > 0));
  return { withMechanism, withoutMechanism };
}

export function buildNpsGroupStats(clients = []) {
  const scores = clients.map((c) => Number(c.latestNps)).filter((s) => Number.isFinite(s));
  const n = clients.length;
  const breakdown = computeNpsBreakdown(scores);
  const promoters = clients.filter((c) => c.latestNps >= 9).length;
  const neutrals = clients.filter((c) => c.latestNps >= 7 && c.latestNps <= 8).length;
  const detractors = clients.filter((c) => c.latestNps <= 6).length;
  return {
    n,
    npsIndex: breakdown.nps,
    meanScore: round1(mean(scores)),
    medianScore: median(scores),
    promoters: { n: promoters, pct: pct(promoters, n) },
    neutrals: { n: neutrals, pct: pct(neutrals, n) },
    detractors: { n: detractors, pct: pct(detractors, n) },
  };
}

function interpretAssociation(measure, value) {
  if (value == null || !Number.isFinite(Number(value))) return "Sem associação calculável.";
  const abs = Math.abs(Number(value));
  const strength = associationStrength(abs, measure === "cramers_v" ? "cramers_v" : "point-biserial");
  const dir = Number(value) > 0 ? "positiva" : Number(value) < 0 ? "negativa" : "nula";
  return `Associação ${dir} ${strength} (${measure}). Não implica causalidade.`;
}

function buildMatrixCell({
  labelA,
  labelB,
  measure,
  value,
  n,
  coveragePercent,
  extra = "",
}) {
  return {
    association: value != null ? round3(value) : null,
    associationMeasure: measure,
    n,
    coveragePercent,
    tip: `${labelA}\nVariável: ${labelB}\nMedida: ${measure}\nValor: ${value != null ? String(value).replace(".", ",") : "—"}\nN: ${n ?? "—"} clientes\nCobertura: ${coveragePercent ?? "—"}%\n${interpretAssociation(measure, value)}${extra ? `\n${extra}` : ""}`,
  };
}

function cramersMechanismVsClass(npsPopulation, field) {
  const labels = ["detrator", "neutro", "promotor"];
  const table = [[0, 0, 0], [0, 0, 0]];
  for (const c of npsPopulation) {
    const y = c[field] ? 1 : 0;
    const cls = c.latestNpsClass;
    const col = cls === "promotor" ? 2 : cls === "neutro" ? 1 : cls === "detrator" ? 0 : -1;
    if (col < 0) continue;
    table[y][col] += 1;
  }
  const chi = chiSquareIndependence(table);
  const n = table.flat().reduce((a, b) => a + b, 0);
  return { cramersV: chi.cramersV, n, warning: chi.warning };
}

function columnDefs() {
  return [
    { id: "promoter", label: "Promotor", sublabel: "associação" },
    { id: "neutral", label: "Neutro", sublabel: "associação" },
    { id: "detractor", label: "Detrator", sublabel: "associação" },
    { id: "csat", label: "CSAT", sublabel: "média" },
    { id: "renewal", label: "Renovação", sublabel: "taxa %" },
  ];
}

export function matrixAssociationStrengthLabel(absR) {
  const abs = Math.abs(Number(absR));
  if (!Number.isFinite(abs)) return "Sem dado";
  if (abs < 0.1) return "Muito fraca";
  if (abs < 0.3) return "Fraca";
  if (abs < 0.5) return "Moderada";
  return "Forte";
}

export function matrixAssociationInterpretation(value) {
  const abs = Math.abs(Number(value));
  if (!Number.isFinite(abs)) return "Sem relação calculável neste recorte.";
  if (abs < 0.1) return "Praticamente não há relação observada neste recorte.";
  if (Number(value) > 0) return "Tendência positiva: as duas coisas aparecem juntas com mais frequência.";
  return "Tendência negativa: quando uma sobe, a outra tende a ser menor.";
}

function scoreSeries(npsPopulation) {
  return npsPopulation.map((c) => Number(c.latestNps));
}

function binarySeries(npsPopulation, field) {
  return npsPopulation.map((c) => (c[field] ? 1 : 0));
}

function countSeries(npsPopulation) {
  return npsPopulation.map((c) => Number(c.totalImplementedMechanisms || 0));
}

function buildRowCells(npsPopulation, predictor, { isAggregate = false, minSample = IMS_MECHANISM_MIN_N }) {
  const cols = columnDefs();
  const cells = {};
  const nPred = isAggregate
    ? npsPopulation.filter((c) => c.totalImplementedMechanisms > 0).length
    : npsPopulation.filter((c) => c[predictor.field]).length;
  const smallSample = nPred < minSample;

  const scores = scoreSeries(npsPopulation);
  const predBinary = predictor.type === "binary" ? binarySeries(npsPopulation, predictor.field) : null;
  const predCount = predictor.type === "count" ? countSeries(npsPopulation) : null;

  if (predictor.type === "binary") {
    for (const [colId, flagField] of [
      ["promoter", "npsIsPromoter"],
      ["neutral", "npsIsNeutral"],
      ["detractor", "npsIsDetractor"],
    ]) {
      const pbCol = pointBiserial(
        npsPopulation.map((c) => c[flagField]),
        predBinary,
      );
      cells[colId] = {
        ...buildMatrixCell({
          labelA: predictor.label,
          labelB: cols.find((c) => c.id === colId)?.label || colId,
          measure: "point_biserial",
          value: pbCol.r,
          n: pbCol.n,
          coveragePercent: coveragePct(nPred, npsPopulation.length),
        }),
        status: smallSample ? "small_sample" : "ok",
      };
    }
    const cram = cramersMechanismVsClass(
      npsPopulation.filter((c) => c[predictor.field] || !c[predictor.field]),
      predictor.field,
    );
    cells.neutral.cramersV = cram.cramersV;
  }

  if (predictor.type === "count") {
    const counts = countSeries(npsPopulation);
    for (const [colId, flagField] of [
      ["promoter", "npsIsPromoter"],
      ["neutral", "npsIsNeutral"],
      ["detractor", "npsIsDetractor"],
    ]) {
      const pbCol = pointBiserial(counts, npsPopulation.map((c) => c[flagField]));
      cells[colId] = {
        ...buildMatrixCell({
          labelA: predictor.label,
          labelB: cols.find((c) => c.id === colId)?.label || colId,
          measure: "point_biserial",
          value: pbCol.r,
          n: pbCol.n,
          coveragePercent: 100,
        }),
        status: npsPopulation.length < minSample ? "small_sample" : "ok",
      };
    }
  }

  const withM = npsPopulation.filter((c) =>
    predictor.type === "binary" ? c[predictor.field] : (c.totalImplementedMechanisms || 0) > 0,
  );
  const csatScores = withM.map((c) => c.latestCsat).filter((v) => v != null);
  cells.csat = {
    value: round1(mean(csatScores)),
    measure: "csat_mean",
    n: csatScores.length,
    coveragePercent: coveragePct(csatScores.length, nPred || withM.length),
    status: "secondary",
    tip: "CSAT — análise secundária (subpopulação com CSAT).",
  };
  const renEligible = withM.filter((c) => c.cycleValid);
  const renRate = renEligible.length
    ? pct(renEligible.filter((c) => c.renewed).length, renEligible.length)
    : null;
  cells.renewal = {
    value: renRate,
    measure: "renewal_rate_pct",
    n: renEligible.length,
    status: "secondary",
    tip: "Renovação — análise secundária (ciclo válido).",
  };

  return { cells, nPred, smallSample };
}

export function buildNpsMechanismMatrix(npsPopulation, catalog, minSample = IMS_MECHANISM_MIN_N) {
  const columns = columnDefs();
  const rows = [];

  const hasRow = buildRowCells(npsPopulation, {
    type: "binary",
    field: "hasMechanismImplemented",
    label: "Possui mecanismo",
  }, { isAggregate: true, minSample });
  rows.push({
    id: "has_mechanism",
    label: "Possui mecanismo",
    clients: hasRow.nPred,
    smallSample: hasRow.smallSample,
    cells: hasRow.cells,
  });

  const qtyRow = buildRowCells(
    npsPopulation,
    { type: "count", field: "totalImplementedMechanisms", label: "Quantidade de mecanismos" },
    { minSample },
  );
  rows.push({
    id: "mechanism_count",
    label: "Quantidade de mecanismos",
    clients: npsPopulation.length,
    smallSample: npsPopulation.length < minSample,
    cells: qtyRow.cells,
  });

  for (const mech of catalog) {
    const field = `implemented_${mech.slug}`;
    const row = buildRowCells(
      npsPopulation,
      { type: "binary", field, label: mech.name },
      { minSample },
    );
    rows.push({
      id: mech.id,
      slug: mech.slug,
      label: mech.name,
      clients: row.nPred,
      smallSample: row.smallSample,
      cells: row.cells,
    });
  }

  return { columns, rows, cornerLabel: "Mecanismo / variável", title: "Matriz de relações — Mecanismos × NPS" };
}

export function buildComVsSemComparison(withMechanism, withoutMechanism) {
  const a = buildNpsGroupStats(withMechanism);
  const b = buildNpsGroupStats(withoutMechanism);
  const diff = (x, y) => (x != null && y != null ? round3(x - y) : null);
  return {
    withMechanism: a,
    withoutMechanism: b,
    table: [
      { indicator: "Clientes", with: a.n, without: b.n, diff: diff(a.n, b.n) },
      { indicator: "NPS", with: a.npsIndex, without: b.npsIndex, diff: diff(a.npsIndex, b.npsIndex) },
      { indicator: "Nota média NPS", with: a.meanScore, without: b.meanScore, diff: diff(a.meanScore, b.meanScore) },
      { indicator: "Mediana", with: a.medianScore, without: b.medianScore, diff: diff(a.medianScore, b.medianScore) },
      { indicator: "Promotores %", with: a.promoters.pct, without: b.promoters.pct, diff: diff(a.promoters.pct, b.promoters.pct) },
      { indicator: "Neutros %", with: a.neutrals.pct, without: b.neutrals.pct, diff: diff(a.neutrals.pct, b.neutrals.pct) },
      { indicator: "Detratores %", with: a.detractors.pct, without: b.detractors.pct, diff: diff(a.detractors.pct, b.detractors.pct) },
    ],
  };
}

export function buildGroupStatisticalTest(withMechanism, withoutMechanism) {
  const aScores = withMechanism.map((c) => Number(c.latestNps)).filter(Number.isFinite);
  const bScores = withoutMechanism.map((c) => Number(c.latestNps)).filter(Number.isFinite);
  const mw = mannWhitney(aScores, bScores);
  const meanA = round1(mean(aScores));
  const meanB = round1(mean(bScores));
  const medA = median(aScores);
  const medB = median(bScores);
  return {
    test: "Mann–Whitney U",
    pValue: mw.pValue,
    rankBiserial: mw.rankBiserial,
    effectLabel: associationStrength(Math.abs(mw.rankBiserial ?? 0), "point-biserial"),
    nWith: aScores.length,
    nWithout: bScores.length,
    meanDiff: meanA != null && meanB != null ? round3(meanA - meanB) : null,
    medianDiff: medA != null && medB != null ? round3(medA - medB) : null,
    warning: mw.warning,
  };
}

export function buildScoreDistribution(withMechanism, withoutMechanism) {
  const buckets = Array.from({ length: 11 }, (_, score) => {
    const w = withMechanism.filter((c) => c.latestNps === score).length;
    const wo = withoutMechanism.filter((c) => c.latestNps === score).length;
    return {
      score,
      withMechanism: w,
      withoutMechanism: wo,
      withPct: pct(w, withMechanism.length),
      withoutPct: pct(wo, withoutMechanism.length),
    };
  });
  return buckets;
}

export function buildMechanismNpsRanking(npsPopulation, catalog, minSample = IMS_MECHANISM_MIN_N) {
  return catalog
    .map((mech) => {
      const field = `implemented_${mech.slug}`;
      const clients = npsPopulation.filter((c) => c[field]);
      const stats = buildNpsGroupStats(clients);
      return {
        mechanismId: mech.id,
        mechanismName: mech.name,
        slug: mech.slug,
        clientsWithNps: stats.n,
        npsIndex: stats.npsIndex,
        meanScore: stats.meanScore,
        medianScore: stats.medianScore,
        promotersPct: stats.promoters.pct,
        neutralsPct: stats.neutrals.pct,
        detractorsPct: stats.detractors.pct,
        coveragePct: coveragePct(stats.n, npsPopulation.length),
        smallSample: stats.n < minSample,
      };
    })
    .filter((r) => r.clientsWithNps > 0)
    .sort((a, b) => (b.meanScore ?? -1) - (a.meanScore ?? -1));
}

export function buildNpsClientRows(npsPopulation) {
  return npsPopulation.map((c) => ({
    clientId: c.clientId,
    clientCode: c.clientCode,
    clientName: c.clientName,
    ep: c.ep,
    program: c.program,
    segment: c.segment,
    npsScore: c.latestNps,
    npsClass: c.latestNpsClass,
    npsDate: c.latestNpsDate,
    hasMechanism: (c.totalImplementedMechanisms || 0) > 0,
    mechanismCount: c.totalImplementedMechanisms || 0,
    mechanismNames: c.implementedMechanismLabels || "Sem mecanismo",
    implementedBeforeNps: c.implementedBeforeLatestNps === true,
    npsResponseCount: c.npsResponseCount || 1,
  }));
}

export function paginateNpsClients(rows, { page = 1, pageSize = 25, sortKey = "npsScore", sortDir = "desc", search = "" } = {}) {
  let list = [...rows];
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) =>
        String(r.clientName || "").toLowerCase().includes(q)
        || String(r.clientCode || "").toLowerCase().includes(q)
        || String(r.mechanismNames || "").toLowerCase().includes(q),
    );
  }
  const dir = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "pt-BR") * dir;
  });
  const total = list.length;
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(10, Number(pageSize) || 10));
  const start = (p - 1) * size;
  return { page: p, pageSize: size, total, rows: list.slice(start, start + size) };
}

export function buildNpsInsights(npsPopulation, comparison, ranking, groupTest, minSample) {
  const { withMechanism, withoutMechanism } = splitWithWithoutMechanism(npsPopulation);
  const insights = [];
  const a = comparison.withMechanism;
  const b = comparison.withoutMechanism;
  if (a.n && b.n) {
    insights.push({
      kind: "comparacao",
      text: `Clientes com mecanismo tiveram NPS ${a.npsIndex ?? "—"} (nota média ${a.meanScore ?? "—"}, n=${a.n}); sem mecanismo: NPS ${b.npsIndex ?? "—"} (nota média ${b.meanScore ?? "—"}, n=${b.n}).`,
      n: a.n + b.n,
    });
  }
  const eligible = ranking.filter((r) => !r.smallSample);
  if (eligible[0]) {
    insights.push({
      kind: "mecanismo",
      text: `${eligible[0].mechanismName} lidera nota média entre mecanismos com n≥${minSample} (${eligible[0].meanScore}, N=${eligible[0].clientsWithNps}).`,
      n: eligible[0].clientsWithNps,
    });
  } else {
    insights.push({
      kind: "amostra",
      text: `Nenhum mecanismo atinge amostra mínima (n≥${minSample}) no recorte para destacar desempenho.`,
    });
  }
  if (withMechanism.length + withoutMechanism.length !== npsPopulation.length) {
    insights.push({ kind: "warn", text: "Inconsistência na partição com/sem mecanismo — revisar filtros." });
  }
  return insights;
}

export function buildPopulationMeta(wideFiltered, npsPopulation, npsMeta = {}, joinDiagnostics = null) {
  const multi = npsPopulation.filter((c) => (c.npsResponseCount || 1) > 1).length;
  const join = joinDiagnostics || {};
  return {
    primaryUniverse: "clientes_com_nps_valido",
    clientsInFilters: wideFiltered.length,
    clientsWithNps: npsPopulation.length,
    withMechanism: npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0).length,
    withoutMechanism: npsPopulation.filter((c) => !(c.totalImplementedMechanisms > 0)).length,
    mechanismCoverageAmongNps: pct(
      npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0).length,
      npsPopulation.length,
    ),
    portfolioNpsCoveragePct: coveragePct(npsPopulation.length, wideFiltered.length),
    npsMeta: {
      rawResponses: join.rawResponses ?? npsMeta.rawResponses ?? null,
      dedupedClients: join.dedupedClients ?? npsMeta.respondentClients ?? npsPopulation.length,
      matchedToBaseClients: join.matchedToBaseClients ?? null,
      unmatchedDeduped: join.unmatchedDeduped ?? null,
      withoutClientId: join.withoutClientId ?? npsMeta.withoutClientId ?? null,
      dedupeRule: join.dedupeRule ?? npsMeta.dedupeRule ?? "latest por cliente (oficial)",
      clientsMultipleResponses: multi,
    },
    distinctMechanismsInAnalysis: new Set(
      npsPopulation.flatMap((c) => c.implementedMechanismNames || []),
    ).size,
  };
}

export function buildTemporalNpsFlags(npsPopulation) {
  const withMech = npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0);
  const withDate = withMech.filter((c) => c.latestNpsDate);
  const before = withMech.filter((c) => c.implementedBeforeLatestNps).length;
  return {
    implementedBeforeNpsAvailable: withDate.length > 0,
    clientsWithMechanismAndNps: withMech.length,
    implementedBeforeNpsCount: before,
    implementedBeforeNpsPct: pct(before, withMech.length),
    message:
      withDate.length > 0
        ? `${before} de ${withMech.length} clientes com NPS e mecanismo possuem ao menos um mecanismo implementado na data da resposta NPS ou antes.`
        : "Datas de implementação ou NPS insuficientes para análise temporal confiável.",
  };
}
