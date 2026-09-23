/**
 * Geração dos CSVs analíticos — Mecanismos × Satisfação (nível cliente + agregados).
 */
import { CALCULATION_VERSION } from "../cache/analytics-cache.mjs";
import { mechanismSlugFromName } from "./mechanisms-satisfaction-dataset.mjs";
import { IMS_MECHANISM_MIN_N } from "./internal-mechanisms-nps-focus.mjs";

function csvCell(value) {
  if (value == null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return "";
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function formatSemicolonCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(";")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(";"));
  }
  return `\uFEFF${lines.join("\n")}\r\n`;
}

function pipeNames(names) {
  if (!names?.length) return "";
  return names.join("|");
}

function mechanismDatesForClient(longRows, clientId) {
  const dates = (longRows || [])
    .filter((r) => r.clientId === clientId && r.mechanismImplemented && r.mechanismImplementationDate)
    .map((r) => r.mechanismImplementationDate);
  return [...new Set(dates)].join("|");
}

function countMechBeforeNps(longRows, clientId, npsDate) {
  if (!npsDate) return null;
  return (longRows || []).filter(
    (r) =>
      r.clientId === clientId
      && r.mechanismImplemented
      && r.mechanismImplementationDate
      && r.mechanismImplementationDate <= npsDate,
  ).length;
}

export function buildCompletaClientRows(npsPopulation, catalog, longRows) {
  return npsPopulation.map((c) => {
    const row = {
      client_id: c.clientId,
      client_code: c.clientCode ?? "",
      client_name: c.clientName ?? "",
      analytical_status: c.analyticalStatus ?? "",
      ep: c.ep ?? "",
      segment: c.segment ?? "",
      program: c.program ?? "",
      entry_date: c.entryDate ?? "",
      tenure_days: c.tenureDays ?? "",
      latest_nps: c.latestNps ?? "",
      latest_nps_date: c.latestNpsDate ?? "",
      nps_class: c.latestNpsClass ?? "",
      nps_response_count: c.npsResponseCount ?? "",
      latest_csat: c.latestCsat ?? "",
      latest_csat_date: c.latestCsatDate ?? "",
      csat_response_count: c.csatResponseCount ?? "",
      csat_satisfied: c.csatSatisfied === true ? 1 : c.csatSatisfied === false ? 0 : "",
      has_mechanism: (c.totalImplementedMechanisms || 0) > 0 ? 1 : 0,
      mechanism_count: c.totalImplementedMechanisms ?? 0,
      mechanism_names: pipeNames(c.implementedMechanismNames),
      mechanism_ids: (catalog || [])
        .filter((m) => c[`implemented_${m.slug}`])
        .map((m) => m.id)
        .join("|"),
      mechanisms_implemented_before_nps_count: countMechBeforeNps(longRows, c.clientId, c.latestNpsDate),
      has_mechanism_before_nps: c.implementedBeforeLatestNps === true ? 1 : c.implementedBeforeLatestNps === false ? 0 : "",
      mechanism_implementation_dates: mechanismDatesForClient(longRows, c.clientId),
      renewed: c.cycleValid ? (c.renewed ? 1 : 0) : "",
      renewal_count: c.renewalCount ?? "",
      current_cycle: c.currentCycle ?? "",
      renewal_date: "",
    };
    for (const m of catalog || []) {
      row[`has_${m.slug}`] = c[`implemented_${m.slug}`] ? 1 : 0;
    }
    return row;
  });
}

export function buildCompletaHeaders(catalog) {
  const base = [
    "client_id",
    "client_code",
    "client_name",
    "analytical_status",
    "ep",
    "segment",
    "program",
    "entry_date",
    "tenure_days",
    "latest_nps",
    "latest_nps_date",
    "nps_class",
    "nps_response_count",
    "latest_csat",
    "latest_csat_date",
    "csat_response_count",
    "csat_satisfied",
    "has_mechanism",
    "mechanism_count",
    "mechanism_names",
    "mechanism_ids",
    "mechanisms_implemented_before_nps_count",
    "has_mechanism_before_nps",
    "mechanism_implementation_dates",
    "renewed",
    "renewal_count",
    "current_cycle",
    "renewal_date",
  ];
  for (const m of catalog || []) base.push(`has_${m.slug}`);
  return base;
}

export function buildContextoRows(catalog) {
  const rows = [
    {
      campo: "generated_at",
      descricao: "Data/hora UTC da extração",
      regra: "Momento da geração do arquivo",
      fonte: "script export IMS",
      observacao: "",
    },
    {
      campo: "calculation_version",
      descricao: "Versão do compute analytics",
      regra: CALCULATION_VERSION,
      fonte: "lib/cache/analytics-cache.mjs",
      observacao: "",
    },
    {
      campo: "latest_nps",
      descricao: "Nota NPS mais recente do cliente",
      regra: "Dedupe oficial: submitted_at desc, created_at desc",
      fonte: "BASE QV nps_responses",
      observacao: "Escala 0–10",
    },
    {
      campo: "nps_class",
      descricao: "Classe NPS (promotor/neutro/detrator)",
      regra: "Regra oficial NPS QuartaVia",
      fonte: "nps-metrics.mjs",
      observacao: "",
    },
    {
      campo: "latest_csat",
      descricao: "Nota CSAT mais recente",
      regra: "Resposta válida 1–5",
      fonte: "BASE QV csat_responses",
      observacao: "",
    },
    {
      campo: "csat_satisfied",
      descricao: "Cliente satisfeito no CSAT",
      regra: "Regra oficial CSAT do dataset",
      fonte: "mechanisms-satisfaction-dataset.mjs",
      observacao: "1/0 ou vazio",
    },
    {
      campo: "has_mechanism",
      descricao: "Possui ≥1 mecanismo implementado",
      regra: "Status implementado BASE QV",
      fonte: "client_mechanisms + mechanism-status",
      observacao: "",
    },
    {
      campo: "mechanism_names",
      descricao: "Nomes dos mecanismos implementados",
      regra: "Separador pipe |",
      fonte: "catálogo Pharus/BASE",
      observacao: "",
    },
    {
      campo: "has_<slug>",
      descricao: "Coluna binária por mecanismo do catálogo",
      regra: "1 possui · 0 não possui",
      fonte: "implemented_<slug> no wide client",
      observacao: `${(catalog || []).length} mecanismos no catálogo atual`,
    },
    {
      campo: "renewed",
      descricao: "Renovou ciclo atual",
      regra: "Somente se cycleValid",
      fonte: "client-cycle-renewal.mjs",
      observacao: "Vazio se ciclo inválido",
    },
    {
      campo: "filters",
      descricao: "Filtros aplicados na extração",
      regra: "Ver linha filters no resumo",
      fonte: "internal-mechanisms-satisfaction-filters",
      observacao: "",
    },
  ];
  return rows;
}

export function buildResumoRows(summary, filters, meta = {}) {
  const pairs = [
    ["clientes_com_nps", summary.clientsWithNps],
    ["clientes_com_nps_e_mecanismo", summary.withNpsAndMechanism],
    ["clientes_com_nps_sem_mecanismo", summary.withNpsWithoutMechanism],
    ["nps_indice_com_mecanismo", summary.npsIndexWithMechanism],
    ["nps_indice_sem_mecanismo", summary.npsIndexWithoutMechanism],
    ["nota_media_com_mecanismo", summary.meanScoreWithMechanism],
    ["nota_media_sem_mecanismo", summary.meanScoreWithoutMechanism],
    ["csat_medio_agregado", summary.csatAverage],
    ["clientes_com_csat_no_universo", summary.csatRespondents],
    ["taxa_renovacao_pct", summary.renewalRatePct],
    ["cobertura_mecanismo_entre_nps_pct", summary.mechanismCoverageAmongNpsPct],
    ["mecanismos_distintos", meta.distinctMechanisms],
    ["generated_at", meta.generatedAt],
    ["calculation_version", CALCULATION_VERSION],
    ["filter_status", filters.status ?? "active"],
    ["filter_program", filters.program ?? "all"],
    ["sample_min_ranking", IMS_MECHANISM_MIN_N],
  ];
  return pairs.map(([metrica, valor]) => ({ metrica, valor: valor ?? "" }));
}

export function buildPorMechanismRows(ranking, csatRanking, renewalRanking, minSample = IMS_MECHANISM_MIN_N) {
  const byName = new Map();
  for (const r of ranking || []) {
    byName.set(r.mechanismName, {
      mechanism_name: r.mechanismName,
      clients_with_nps: r.clientsWithNps,
      nps: r.npsIndex,
      nps_mean_score: r.meanScore,
      nps_median: r.medianScore,
      promoter_pct: r.promotersPct,
      neutral_pct: r.neutralsPct,
      detractor_pct: r.detractorsPct,
      coverage_nps: r.coveragePct,
      sample_small: r.clientsWithNps < minSample ? 1 : 0,
    });
  }
  for (const r of csatRanking || []) {
    const cur = byName.get(r.mechanismName) || { mechanism_name: r.mechanismName };
    cur.clients_with_csat = r.clientsWithCsat;
    cur.csat_mean = r.meanCsat;
    cur.coverage_csat = r.coveragePct;
    byName.set(r.mechanismName, cur);
  }
  for (const r of renewalRanking || []) {
    const cur = byName.get(r.mechanismName) || { mechanism_name: r.mechanismName };
    cur.renewal_eligible = r.eligible;
    cur.renewed = r.renewed;
    cur.renewal_rate = r.renewalRatePct;
    byName.set(r.mechanismName, cur);
  }
  return [...byName.values()].sort((a, b) => String(a.mechanism_name).localeCompare(String(b.mechanism_name), "pt-BR"));
}

export function buildDistribuicaoNpsRows(scoreDistribution) {
  return (scoreDistribution || []).map((b) => ({
    nps_score: b.score,
    clients_with_mechanism: b.withMechanism,
    clients_without_mechanism: b.withoutMechanism,
    pct_with_mechanism: b.withPct,
    pct_without_mechanism: b.withoutPct,
  }));
}

export function validateExportBundle(npsPopulation, summary, clientRows) {
  const ids = new Set(clientRows.map((r) => r.client_id));
  const withMech = npsPopulation.filter((c) => (c.totalImplementedMechanisms || 0) > 0).length;
  const withoutMech = npsPopulation.length - withMech;
  const dupes = clientRows.length - ids.size;
  const partitionOk = summary.withNpsAndMechanism + summary.withNpsWithoutMechanism === summary.clientsWithNps;
  return {
    clientRows: clientRows.length,
    uniqueClients: ids.size,
    duplicateClientIds: dupes,
    populationWithNps: npsPopulation.length,
    withMechanism: withMech,
    withoutMechanism: withoutMech,
    partitionValid: partitionOk,
    npsInRange: clientRows.every((r) => {
      const n = Number(r.latest_nps);
      return r.latest_nps === "" || (Number.isFinite(n) && n >= 0 && n <= 10);
    }),
    csatValid: clientRows.every((r) => {
      const n = Number(r.latest_csat);
      return r.latest_csat === "" || (Number.isFinite(n) && n >= 1 && n <= 5);
    }),
  };
}
