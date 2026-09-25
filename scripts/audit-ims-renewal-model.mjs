/**
 * Auditoria offline/live — população de renovação IMS + modelo exploratório.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    parsed[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return parsed;
}

for (const [k, v] of Object.entries(parseEnvFile(resolve(root, ".env")))) {
  if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
}

const { loadMechanismsSatisfactionDataset } = await import("../lib/analytics/mechanisms-satisfaction-dataset.mjs");
const { buildInternalMechanismsSatisfactionPayload } = await import(
  "../lib/analytics/internal-mechanisms-satisfaction.mjs"
);

const filters = { status: "active" };

let dataset;
try {
  dataset = await loadMechanismsSatisfactionDataset();
} catch (error) {
  console.error("Falha ao carregar BASE QV:", error.message);
  process.exit(1);
}

const payload = buildInternalMechanismsSatisfactionPayload(dataset, { filters });
const sum = payload.renewalAnalysis?.populationSummary || {};
const audit = payload.renewalAnalysis?.audit15vs40 || {};
const modelAudit = payload.renewalYearEndProjection?.exploratory?.modelAudit || {};
const perf = modelAudit.performance || {};

console.log(
  JSON.stringify(
    {
      population: sum,
      audit15vs40: audit.metricRows,
      topRawRate: payload.renewalAnalysis?.topByRawRate,
      topAdjusted: payload.renewalAnalysis?.topByAdjustedAssociation,
      modelAudit: {
        algorithm: modelAudit.algorithm,
        target: modelAudit.target,
        sampleSizes: modelAudit.sampleSizes,
        performance: perf,
        thresholdSweep: modelAudit.thresholdSweep,
        utility: modelAudit.utility,
        multicollinearity: modelAudit.multicollinearity,
        backtest: modelAudit.backtest,
      },
    },
    null,
    2,
  ),
);
