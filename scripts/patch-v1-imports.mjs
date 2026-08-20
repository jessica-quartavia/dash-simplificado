/**
 * One-off: adapt copied V1 compute modules to dash-simplificado imports.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const analytics = resolve(root, "lib/analytics");

function patch(path, transforms) {
  let text = readFileSync(path, "utf8");
  for (const [from, to] of transforms) {
    text = text.split(from).join(to);
  }
  writeFileSync(path, text, "utf8");
  console.log("patched", path);
}

const sharedReplacements = [
  ["./_shared/analytical-cancellation.mjs", "./analytical-cancellation.mjs"],
  ["./_shared/data-exclusions.mjs", "./data-exclusions.mjs"],
  ["./_shared/client-tenure.mjs", "./client-tenure.mjs"],
  ["./_shared/cancellation-process.mjs", "./cancellation-process.mjs"],
  ["./_shared/cancellation-reason-category.mjs", "./cancellation-reason-category.mjs"],
  ["./_shared/or-evidence.mjs", "./or-evidence.mjs"],
  ["./_shared/nps-metrics.mjs", "./nps-metrics.mjs"],
];

for (const file of [
  "cancellation-process.mjs",
  "cancellation-reason-category.mjs",
  "nps-metrics.mjs",
  "or-evidence.mjs",
]) {
  patch(resolve(analytics, file), sharedReplacements);
}

function stripHandlerExport(text, computeExportName) {
  const marker = `\nexport default async`;
  const idx = text.indexOf(marker);
  if (idx >= 0) text = text.slice(0, idx).trimEnd() + "\n";
  if (!text.includes(`export async function ${computeExportName}`)) {
    text = text.replace(
      /export async function compute(\w+)Payload\(\)/,
      "export async function compute$1Payload()",
    );
  }
  return text;
}

function addFetchHelper(text) {
  if (text.includes("fetchAllRows")) return text;
  const importBlock = `import { fetchAllRows } from "../data/supabase-rest.mjs";\n`;
  const helper = `
async function fetchTable(table, select, order = "id.asc") {
  return fetchAllRows({ table, select, order: order || "id.asc" });
}
`;
  text = text.replace(/^import/m, importBlock + "import");
  text = text.replace(/\nasync function fetchAll\([\s\S]*?\n\}\n\n/, `\n${helper}\n`);
  text = text.replace(/\bfetchAll\(/g, "fetchTable(");
  return text;
}

function fixFinancial() {
  const path = resolve(analytics, "financial-updates.mjs");
  let text = readFileSync(path, "utf8");
  text = text.replace(/^import[\s\S]*?from "\.\/_shared\/data-exclusions\.mjs";\n\n/m, `import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatus,
} from "./analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";

async function fetchTable(table, select, order = "id.asc") {
  return fetchAllRows({ table, select, order: order || "id.asc" });
}

`);
  text = text.replace(/\nasync function fetchAll\([\s\S]*?\n\}\n\nfunction buildMonthSeries/, "\nfunction buildMonthSeries");
  text = text.replace(/\bfetchAll\(/g, "fetchTable(");
  text = stripHandlerExport(text, "computeFinancialUpdatesPayload");
  if (!text.includes("export function toPublicFinancialUpdatesPayload")) {
    text += `
export function toPublicFinancialUpdatesPayload(payload) {
  if (!payload) return payload;
  const { quality, warnings, ...rest } = payload;
  return { ...rest, warnings: warnings || [], quality: quality || {} };
}
`;
  }
  writeFileSync(path, text, "utf8");
  console.log("patched financial-updates.mjs");
}

function fixSatisfaction() {
  const path = resolve(analytics, "satisfaction.mjs");
  let text = readFileSync(path, "utf8");
  text = text.replace(/^import[\s\S]*?from "\.\/_shared\/data-exclusions\.mjs";\n\n/m, `import { dataConfigurationError, getDataEnv } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { excludedClientIds, filterExcludedClients, isExcludedClient } from "./data-exclusions.mjs";
import { dedupeNpsResponses, computeNpsBreakdown } from "./nps-metrics.mjs";

async function fetchTable(table, select, order = "created_at.asc") {
  return fetchAllRows({ table, select, order: order || "created_at.asc" });
}

`);
  text = text.replace(/\nasync function fetchAll\([\s\S]*?\n\}\n\nfunction buildNpsMonthly/, "\nfunction buildNpsMonthly");
  text = text.replace(/\bfetchAll\(/g, "fetchTable(");
  text = text.replace(/export default async function handler[\s\S]*$/m, "");
  if (!text.includes("export async function computeSatisfactionPayload")) {
    text += `
export async function computeSatisfactionPayload() {
  const configError = dataConfigurationError();
  if (configError) {
    const err = new Error(configError);
    err.code = "config";
    throw err;
  }
  const clientsRaw = await fetchTable("clients", "id,codigo,name,email,status,engenheiro_patrimonial,programa");
  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const clientMap = new Map(clients.map((c) => [String(c.id), c]));
  const npsRowsRaw = await fetchTable(
    "nps_responses",
    "id,client_id,score,created_at,tipo_de_forms,typeform_response_id,client_name,client_email,raw_payload,typeform_form_id",
  );
  const csatRowsRaw = await fetchTable(
    "csat_responses",
    "id,client_id,score,created_at,tipo_de_forms,typeform_response_id,client_name,client_email,raw_payload,typeform_form_id",
  );
  const npsRows = npsRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  const csatRows = csatRowsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
  return buildSatisfactionPayload({ clients, clientMap, npsRows, csatRows });
}

export function toPublicSatisfactionPayload(payload) {
  return payload;
}
`;
  }
  writeFileSync(path, text, "utf8");
  console.log("patched satisfaction.mjs");
}

function fixCancellations() {
  const path = resolve(analytics, "cancellations.mjs");
  let text = readFileSync(path, "utf8");
  text = text.replace(
    /^import { requireCorporateAuth }[\s\S]*?from "\.\/_shared\/data-exclusions\.mjs";\n\n/m,
    `import { dataConfigurationError } from "../env.mjs";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { calculateClientSegment } from "./client-segment.mjs";
import {
  CANCELLATION_REASON_CATEGORIES,
  categorizeCancellationReason,
} from "./cancellation-reason-category.mjs";
import {
  parseFlexibleDate,
  buildAnalyticalCancellationMap,
  resolveAnalyticalStatusFromMaps,
} from "./analytical-cancellation.mjs";
import {
  CANCELLATION_PROCESS_SELECT,
  STAGE,
  STAGE_KEYS,
  buildCancellationProcessMap,
  medianOf,
  rateOrInsufficient,
  validPositiveDays,
  blankToNull,
  toNumber,
  resolveAnalyticalProcessSituation,
  isIntentionPedidoStatusName,
} from "./cancellation-process.mjs";
import { buildOrEvidenceGroup, statusNameMatches } from "./or-evidence.mjs";
import { applyRenewalTenureAdjustment, stayMonthsFromDays } from "./client-tenure.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";

async function fetchTable(table, select, order = "id.asc") {
  return fetchAllRows({ table, select, order: order || "id.asc" });
}

`,
  );
  text = text.replace(/\nasync function fetchAll\([\s\S]*?\n\}\n\nfunction foldToken/, "\nfunction foldToken");
  text = text.replace(/\bfetchAll\(/g, "fetchTable(");
  text = stripHandlerExport(text, "computeCancellationsPayload");
  if (!text.includes("export function toPublicCancellationsPayload")) {
    text += `
export function toPublicCancellationsPayload(payload) {
  return payload;
}
`;
  }
  writeFileSync(path, text, "utf8");
  console.log("patched cancellations.mjs");
}

fixFinancial();
fixSatisfaction();
fixCancellations();
