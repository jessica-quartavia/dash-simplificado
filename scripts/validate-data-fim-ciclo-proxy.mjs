#!/usr/bin/env node
/**
 * Validação read-only: data_fim_ciclo como proxy (BASE QV).
 * Uso: node scripts/validate-data-fim-ciclo-proxy.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import { dataConfigurationError } from "../lib/env.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "../lib/analytics/analytical-cancellation.mjs";
import { calendarDateFromValue, renewalFromClient } from "../lib/analytics/client-cycle-renewal.mjs";
import { calculateClientSegment } from "../lib/analytics/client-segment.mjs";
import { filterExcludedClients } from "../lib/analytics/data-exclusions.mjs";
import { resolveClientProgram } from "../lib/analytics/filters/program.mjs";
import { validateDataFimCicloProxy } from "../lib/analytics/cycle-end-date-proxy-validation.mjs";
import { buildExploratoryRenewalProjection } from "../lib/analytics/internal-mechanisms-renewal-exploratory-projection.mjs";
import { loadMechanismsSatisfactionDataset } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { matchesAnalyticalStatusFilter } from "../lib/analytics/analytical-cancellation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

for (const [k, v] of Object.entries(parseEnvFile(join(ROOT, ".env")))) {
  if (!String(process.env[k] || "").trim()) process.env[k] = v;
}

async function main() {
  const err = dataConfigurationError();
  if (err) {
    console.error(err);
    process.exit(1);
  }

  const dataset = await loadMechanismsSatisfactionDataset();
  const wide = filterExcludedClients(dataset.wideClients || []);
  const validation = validateDataFimCicloProxy(wide);

  const active = wide.filter((c) => matchesAnalyticalStatusFilter(c.analyticalStatus, "active"));
  const { today, horizonEnd } = validation;
  const horizonClients = active.filter(
    (c) => c.cycleEndDate && today && horizonEnd && c.cycleEndDate >= today && c.cycleEndDate <= horizonEnd,
  );

  const proxyOperational = validation.evidence.classification === "A" || validation.evidence.classification === "B";
  const exploratory = proxyOperational
    ? buildExploratoryRenewalProjection(active, horizonClients, dataset.catalog || [], { horizonEnd })
    : null;

  const out = { validation, exploratory, proxyOperational };
  const outPath = join(ROOT, "exports", "validate_data_fim_ciclo_proxy.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(JSON.stringify({
    classification: validation.evidence.classification,
    coverageBothPct: validation.metrics.coverage.bothDatesPct,
    horizonTotal: validation.metrics.horizon.total,
    pharus: validation.metrics.horizon.pharus,
    davos: validation.metrics.horizon.davos,
    proxyOperational: out.proxyOperational,
    modelAvailable: exploratory?.available ?? false,
    expectedRenewals: exploratory?.expectation?.expectedRenewals ?? null,
    expectedRatePct: exploratory?.expectation?.expectedRenewalRatePct ?? null,
    outPath,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
