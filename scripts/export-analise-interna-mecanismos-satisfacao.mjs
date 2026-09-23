#!/usr/bin/env node
/**
 * Exportação analítica IMS — CSVs para análise externa (read-only BASE QV).
 * Uso: node scripts/export-analise-interna-mecanismos-satisfacao.mjs [--status=active|all]
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMechanismsSatisfactionDataset } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { buildInternalMechanismsSatisfactionPayload } from "../lib/analytics/internal-mechanisms-satisfaction.mjs";
import {
  buildCompletaClientRows,
  buildCompletaHeaders,
  buildContextoRows,
  buildDistribuicaoNpsRows,
  buildPorMechanismRows,
  buildResumoRows,
  formatSemicolonCsv,
  validateExportBundle,
} from "../lib/analytics/internal-mechanisms-export-files.mjs";
import { buildNpsClientPopulation } from "../lib/analytics/nps-client-join.mjs";
import { filterWideClients } from "../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "exports");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return parsed;
}

for (const [k, v] of Object.entries({ ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) })) {
  if (!String(process.env[k] || "").trim()) process.env[k] = v;
}

const statusArg = process.argv.find((a) => a.startsWith("--status="));
const status = statusArg ? statusArg.split("=")[1] : "active";
const filters = { status, program: "all" };
const generatedAt = new Date().toISOString();

mkdirSync(OUT, { recursive: true });

const ds = await loadMechanismsSatisfactionDataset();
const payload = buildInternalMechanismsSatisfactionPayload(ds, { filters });
const canonical = buildNpsClientPopulation(ds.wideClients, ds.npsDedupedRows);
const npsPopulation = filterWideClients(canonical, filters);
const catalog = ds.catalog || [];
const longFiltered = (ds.longRows || []).filter((r) => npsPopulation.some((c) => c.clientId === r.clientId));

const clientRows = buildCompletaClientRows(npsPopulation, catalog, longFiltered);
const completaHeaders = buildCompletaHeaders(catalog);
const validation = validateExportBundle(npsPopulation, payload.summary, clientRows);

const files = [
  {
    name: "analise_interna_mecanismos_satisfacao_completa.csv",
    headers: completaHeaders,
    rows: clientRows,
  },
  {
    name: "analise_interna_mecanismos_satisfacao_contexto.csv",
    headers: ["campo", "descricao", "regra", "fonte", "observacao"],
    rows: buildContextoRows(catalog).map((r) => ({
      ...r,
      observacao:
        r.campo === "generated_at"
          ? generatedAt
          : r.campo === "filters"
            ? JSON.stringify(filters)
            : r.observacao,
    })),
  },
  {
    name: "analise_interna_mecanismos_satisfacao_resumo.csv",
    headers: ["metrica", "valor"],
    rows: buildResumoRows(payload.summary, filters, {
      generatedAt,
      distinctMechanisms: payload.population?.distinctMechanismsInAnalysis,
    }),
  },
  {
    name: "analise_interna_mecanismos_satisfacao_por_mecanismo.csv",
    headers: [
      "mechanism_name",
      "clients_with_nps",
      "nps",
      "nps_mean_score",
      "nps_median",
      "promoter_pct",
      "neutral_pct",
      "detractor_pct",
      "clients_with_csat",
      "csat_mean",
      "renewal_eligible",
      "renewed",
      "renewal_rate",
      "coverage_nps",
      "coverage_csat",
      "sample_small",
    ],
    rows: buildPorMechanismRows(
      payload.mechanismRanking,
      payload.csatAnalysis?.mechanismRanking,
      payload.renewalAnalysis?.mechanismRanking,
    ),
  },
  {
    name: "analise_interna_mecanismos_satisfacao_distribuicao_nps.csv",
    headers: [
      "nps_score",
      "clients_with_mechanism",
      "clients_without_mechanism",
      "pct_with_mechanism",
      "pct_without_mechanism",
    ],
    rows: buildDistribuicaoNpsRows(payload.charts?.scoreDistribution || payload.scoreDistribution),
  },
];

const report = { generatedAt, filters, validation, files: [] };

for (const f of files) {
  const path = join(OUT, f.name);
  writeFileSync(path, formatSemicolonCsv(f.headers, f.rows), "utf8");
  const st = statSync(path);
  report.files.push({
    file: f.name,
    lines: f.rows.length + 1,
    dataRows: f.rows.length,
    columns: f.headers.length,
    bytes: st.size,
  });
}

console.log(JSON.stringify(report, null, 2));

if (!validation.partitionValid || validation.duplicateClientIds > 0) {
  process.exitCode = 1;
}
