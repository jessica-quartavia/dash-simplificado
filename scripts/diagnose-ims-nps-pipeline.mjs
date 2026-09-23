/**
 * Diagnóstico IMS NPS — pipeline status all vs active (runtime real BASE QV).
 * Uso: node scripts/diagnose-ims-nps-pipeline.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAnalyticalStatusFilter } from "../lib/analytics/analytical-cancellation.mjs";
import { buildOfficialNpsProgramBreakdown } from "../lib/analytics/satisfaction.mjs";
import {
  fetchMechanismsSatisfactionRawData,
  loadMechanismsSatisfactionDataset,
} from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { buildInternalMechanismsSatisfactionPayload } from "../lib/analytics/internal-mechanisms-satisfaction.mjs";
import { filterWideClients } from "../lib/analytics/internal-mechanisms-satisfaction-filters.mjs";
import { buildNpsClientPopulation } from "../lib/analytics/nps-client-join.mjs";
import { mechanismSlugFromName } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

for (const [k, v] of Object.entries({ ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) })) {
  process.env[k] = v;
}

function statusCounts(rows) {
  const m = new Map();
  for (const r of rows) {
    const st = String(r.analyticalStatus || "(vazio)");
    m.set(st, (m.get(st) || 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

function mechCounts(population, slug) {
  const field = `implemented_${slug}`;
  const withMech = population.filter((c) => c[field]);
  const active = withMech.filter((c) => matchesAnalyticalStatusFilter(c.analyticalStatus, "active"));
  return { totalWithMechanism: withMech.length, withNps: withMech.length, withNpsActive: active.length };
}

const MECH_NAMES = ["Autoconstrução", "Arcadia", "Leilão Serial"];

const ds = await loadMechanismsSatisfactionDataset();
const canonical = buildNpsClientPopulation(ds.wideClients, ds.npsDedupedRows);
const afterAll = filterWideClients(canonical, { status: "all" });
const afterActive = filterWideClients(canonical, { status: "active" });

const payloadAll = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "all" } });
const payloadActive = buildInternalMechanismsSatisfactionPayload(ds, { filters: { status: "active" } });

const clientMap = new Map(
  (ds.wideClients || []).map((w) => [String(w.clientId), { id: w.clientId, codigo: w.clientCode, programa: w.program }]),
);
const raw = await fetchMechanismsSatisfactionRawData();
const sat = buildOfficialNpsProgramBreakdown(raw.npsRaw, clientMap);

const pipeline = {
  rawResponses: ds.npsMeta?.rawResponses,
  dedupedClients: ds.npsDedupedRows?.length,
  matchedBase: payloadAll.npsJoin?.matchedToBaseClients,
  unmatched: payloadAll.npsJoin?.unmatchedDeduped,
  canonicalPopulation: canonical.length,
  afterStatusAll: afterAll.length,
  afterStatusActive: afterActive.length,
  payloadSummaryAll: payloadAll.summary,
  payloadSummaryActive: payloadActive.summary,
};

const statusDistCanonical = statusCounts(canonical);
const statusDistActiveMatch = canonical.filter((c) => matchesAnalyticalStatusFilter(c.analyticalStatus, "active")).length;

const mechDiag = {};
for (const name of MECH_NAMES) {
  const slug = mechanismSlugFromName(name);
  const allWide = ds.wideClients.filter((c) => c[`implemented_${slug}`]);
  mechDiag[name] = {
    totalPortfolioWithMech: allWide.length,
    ...mechCounts(canonical, slug),
    activeFiltered: mechCounts(afterActive, slug),
  };
}

const sample = canonical.slice(0, 20).map((r) => ({
  clientId: r.clientId,
  clientCode: r.clientCode,
  analyticalStatus: r.analyticalStatus,
  activeFilter: matchesAnalyticalStatusFilter(r.analyticalStatus, "active"),
  latestNps: r.latestNps,
  mechanismCount: r.totalImplementedMechanisms,
}));

const rankingSample = (payloadActive.mechanismRanking || []).slice(0, 5).map((r) => ({
  mechanismName: r.mechanismName,
  clientsWithNps: r.clientsWithNps,
  clients: r.clients,
}));

console.log(
  JSON.stringify(
    {
      pipeline,
      statusDistCanonical,
      activeViaHelper: statusDistActiveMatch,
      satisfactionUniqueNps: sat.breakdown.total.n,
      imsCanonicalBeforeStatus: canonical.length,
      fidelityBeforeStatus: canonical.length === sat.breakdown.total.n ? "PASS" : "FAIL",
      partitionAll: payloadAll.npsPopulationValid,
      partitionActive: payloadActive.npsPopulationValid,
      mechDiag,
      mechanismValidation: payloadActive.mechanismValidation,
      pipelineDebug: payloadActive.pipelineDebug,
      invariants: payloadActive.invariants,
      rankingSample,
      temporalActive: payloadActive.temporal?.npsSummary,
      csatComVsSemActive: payloadActive.csatAnalysis?.comVsSem,
      sampleRecords: sample,
    },
    null,
    2,
  ),
);
