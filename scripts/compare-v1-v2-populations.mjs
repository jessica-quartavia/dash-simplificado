/**
 * Comparação read-only V1 × V2 por população de client_id (compute live, sem cache/snapshot).
 *
 * Uso:
 *   node scripts/compare-v1-v2-populations.mjs --metric=cancellation_effective
 *   node scripts/compare-v1-v2-populations.mjs --metric=mechanism_clients --all
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  METRIC_IDS,
  V1_SCREENSHOT_REFERENCE,
  applyCancellationScope,
  buildMechanismAuditSummary,
  compareSets,
  crosswalkAuditFromParts,
  extractPopulationSet,
  sampleRowsForDiagnosis,
} from "../lib/analytics/fidelity-populations.mjs";
import { filterCancellationClients } from "../lib/analytics/cancellations-filters.mjs";
import { summarizeCancellationRows } from "../lib/analytics/cancellations-metrics.mjs";
import { summarizeMechanismRows } from "../lib/analytics/mechanism-metrics.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[trimmed.slice(0, eq).trim()] = value;
  }
  return parsed;
}

for (const [key, value] of Object.entries({
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
})) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

function parseArgs(argv) {
  const args = { metric: null, all: false, scope: "v1_ui_default", sample: 12 };
  for (const arg of argv) {
    if (arg === "--all") args.all = true;
    else if (arg.startsWith("--metric=")) args.metric = arg.slice("--metric=".length);
    else if (arg.startsWith("--scope=")) args.scope = arg.slice("--scope=".length);
    else if (arg.startsWith("--sample=")) args.sample = Number(arg.slice("--sample=".length)) || 12;
  }
  return args;
}

async function loadV1Module(relativePath) {
  const abs = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions", relativePath);
  return import(pathToFileURL(abs).href);
}

async function computeLivePayloads() {
  const { computeMechanismsPayload } = await import("../lib/analytics/mechanisms.mjs");
  const { computeCancellationsPayload } = await import("../lib/analytics/cancellations.mjs");
  const v1Cancel = await loadV1Module("cancellations.mjs");
  const v1Mech = await loadV1Module("mechanisms.mjs");

  const [v2Mechanisms, v2Cancellations, v1Mechanisms, v1Cancellations] = await Promise.all([
    computeMechanismsPayload(),
    computeCancellationsPayload(),
    v1Mech.computeMechanismsPayload(),
    v1Cancel.computeCancellationsPayload(),
  ]);

  return { v2Mechanisms, v2Cancellations, v1Mechanisms, v1Cancellations };
}

function rowByClientId(rows, ids) {
  const map = new Map((rows || []).map((r) => [String(r.clientId), r]));
  return ids.map((id) => map.get(String(id))).filter(Boolean);
}

function v1MechanismSetFromCrossSource(v1Mechanisms) {
  const cov = v1Mechanisms?.crossSourceCoverage;
  const baseIds = new Set(
    (v1Mechanisms?.clients || []).map((c) => String(c.clientId)).filter(Boolean),
  );
  if (!cov || cov.consolidatedUniquePeople == null) return baseIds;
  const matchedQv = new Set();
  const consolidated = new Set();
  for (const row of v1Mechanisms?.crossSourceRows || []) {
    if (row.matchStatus === "ambiguous") continue;
    if (row.foundInBaseQv && row.clientId) {
      matchedQv.add(String(row.clientId));
      consolidated.add(String(row.clientId));
    } else if (row.pharusUserId) {
      consolidated.add(`pharus:${row.pharusUserId}`);
    }
  }
  if (!consolidated.size && cov.consolidatedUniquePeople != null) {
    return extractPopulationSet("mechanism_clients", { mechanismsPayload: v1Mechanisms });
  }
  for (const id of baseIds) {
    if (!matchedQv.has(id)) consolidated.add(id);
  }
  return consolidated;
}

function liveCounts(metric, payloads, scope) {
  const { v2Mechanisms, v2Cancellations, v1Mechanisms, v1Cancellations } = payloads;
  const v1Rows = v1Cancellations.clients || v1Cancellations.rows || [];
  const v2Rows = v2Cancellations.clients || v2Cancellations.rows || [];
  const v1Scoped = applyCancellationScope(v1Rows, scope);
  const v2Scoped = filterCancellationClients(v2Rows, { archived: scope === "payload_all" ? "all" : "no" });

  if (metric === "mechanism_clients") {
    const v2Audit = buildMechanismAuditSummary(v2Mechanisms);
    const v1Cov = v1Mechanisms?.crossSourceCoverage || {};
    return {
      v1_live: v1Cov.consolidatedUniquePeople ?? v1Mechanisms.summary?.clientsWithMechanisms ?? null,
      v2_live: v2Audit.consolidatedUniquePeople,
      v1_set: v1MechanismSetFromCrossSource(v1Mechanisms),
      v2_set: extractPopulationSet("mechanism_clients", { mechanismsPayload: v2Mechanisms }),
      audit: { v1: v1Cov, v2: v2Audit },
    };
  }

  const v2Summary = summarizeCancellationRows(v2Scoped, v2Cancellations.summary || {}, {
    allRows: v2Scoped,
  });

  const map = {
    cancellation_effective: {
      v1: v1Scoped.filter((r) => r.hasEfetivado).length,
      v2: v2Summary.effectiveCancellations,
      v1_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }),
      v2_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v2Scoped } }),
    },
    cancellation_intent_request: {
      v1: v1Scoped.filter((r) => r.hasIntentionOrPedido).length,
      v2: v2Summary.intentionsOrOrdersRegistered,
      v1_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }),
      v2_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v2Scoped } }),
    },
    cancellation_in_process: {
      v1: v1Scoped.filter((r) => r.inProcessCurrently).length,
      v2: v2Summary.clientsInCancellationProcess,
      v1_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }),
      v2_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v2Scoped } }),
    },
    non_renewals: {
      v1: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }).size,
      v2: v2Summary.nonRenewals,
      v1_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }),
      v2_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v2Scoped } }),
    },
    early_cancellation: {
      v1: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }).size,
      v2: v2Summary.beforeCycleEnd,
      v1_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v1Scoped } }),
      v2_set: extractPopulationSet(metric, { cancellationsPayload: { clients: v2Scoped } }),
    },
  };

  const entry = map[metric];
  return {
    v1_live: entry.v1,
    v2_live: entry.v2,
    v1_set: entry.v1_set,
    v2_set: entry.v2_set,
  };
}

function classifyDiff(metric, diff, audit) {
  if (diff.only_v1_count === 0 && diff.only_v2_count === 0) return "MATCH";
  if (metric === "mechanism_clients") {
    if (audit?.v2?.pharusConsulted === false) return "IMPLEMENTATION_BUG";
    if (audit?.v1?.consolidatedUniquePeople != null && audit?.v2?.consolidatedUniquePeople == null) {
      return "IMPLEMENTATION_BUG";
    }
  }
  if (metric.startsWith("cancellation_") || metric === "non_renewals" || metric === "early_cancellation") {
    return "FILTER_SCOPE_DIFFERENCE";
  }
  return "RULE_DIVERGENCE";
}

async function compareMetric(metric, payloads, { scope, sample }) {
  const live = liveCounts(metric, payloads, scope);
  const diff = compareSets(live.v1_set, live.v2_set);
  const v1Rows = payloads.v1Cancellations.clients || payloads.v1Cancellations.rows || [];
  const v2Rows = payloads.v2Cancellations.clients || payloads.v2Cancellations.rows || [];

  const result = {
    metric,
    scope,
    generatedAt: new Date().toISOString(),
    v1_screenshot: V1_SCREENSHOT_REFERENCE[metric] ?? null,
    v1_live: live.v1_live,
    v2_live: live.v2_live,
    v1_count: diff.v1_count,
    v2_count: diff.v2_count,
    intersection_count: diff.intersection_count,
    only_v1_count: diff.only_v1_count,
    only_v2_count: diff.only_v2_count,
    only_v1_sample: sampleRowsForDiagnosis(rowByClientId(v1Rows, diff.only_v1.slice(0, sample)), "clientId", sample),
    only_v2_sample: sampleRowsForDiagnosis(rowByClientId(v2Rows, diff.only_v2.slice(0, sample)), "clientId", sample),
    classification: classifyDiff(metric, diff, live.audit),
  };

  if (metric === "mechanism_clients") {
    result.audit = live.audit;
    const baseClients = (payloads.v2Mechanisms?.clients || []).filter(
      (c) => !String(c.clientId).startsWith("pharus:"),
    );
    result.crosswalk = crosswalkAuditFromParts({
      clientsRaw: payloads.v2Mechanisms?.metadata?.clientsRaw || [],
      baseClients,
      pharusRows: payloads.v2Mechanisms?.metadata?.pharusRows || [],
    }).matchMethods;
    result.formula = {
      consolidatedUniquePeople: live.audit?.v2?.consolidatedUniquePeople,
      matchedInBoth: live.audit?.v2?.matchedInBoth,
      baseQvOnly: live.audit?.v2?.baseQvOnly,
      unmatchedAppPharus: live.audit?.v2?.unmatchedAppPharus,
      sum:
        (live.audit?.v2?.matchedInBoth || 0)
        + (live.audit?.v2?.baseQvOnly || 0)
        + (live.audit?.v2?.unmatchedAppPharus || 0),
    };
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));
const metrics = args.all ? METRIC_IDS : [args.metric || "cancellation_effective"];
if (!args.all && !args.metric) {
  console.error("Informe --metric=<id> ou --all");
  process.exit(1);
}

const payloads = await computeLivePayloads();

if (args.all) {
  const out = {};
  for (const metric of metrics) {
    out[metric] = await compareMetric(metric, payloads, args);
  }
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(JSON.stringify(await compareMetric(metrics[0], payloads, args), null, 2));
}
