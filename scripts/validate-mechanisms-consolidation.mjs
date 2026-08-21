/**
 * Validação read-only da consolidação BASE QV + App Pharus.
 * Uso: node scripts/validate-mechanisms-consolidation.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeMechanismsPayload } from "../lib/analytics/mechanisms.mjs";
import { defaultMechanismFilters } from "../lib/analytics/mechanism-filters.mjs";
import { probePharusAccess } from "../lib/data/pharus-rest.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
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

for (const [key, value] of Object.entries({
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
})) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

const filters = { ...defaultMechanismFilters(), status: "all", program: "all" };
const payload = await computeMechanismsPayload();
const quality = payload.metadata?.consolidationQuality || {};
const base = quality.baseQv || payload.metadata?.baseQvAudit || {};
const app = quality.appPharus || {};
const clients = quality.clients || {};
const links = quality.links || {};
const types = quality.types || {};
const totals = quality.totals || {};
const probe = await probePharusAccess();

const report = {
  filters,
  pharusProbe: probe.tables,
  pharusStatus: {
    consulted: payload.timing?.pharusConsulted ?? false,
    sources: payload.metadata?.sources || [],
    note: payload.metadata?.pharusNote || null,
  },
  baseQv: {
    clientsWithMechanisms: base.clientsWithMechanisms,
    clientsImplemented: base.clientsWithImplementedMechanism,
    links: base.links,
    implementedLinks: base.implementedLinks,
    types: base.mechanismTypes,
  },
  appPharus: {
    consulted: payload.timing?.pharusConsulted ?? false,
    clientsWithMechanisms: app.clientsWithMechanisms ?? 0,
    clientsImplemented: app.clientsWithImplementedMechanism ?? 0,
    links: app.links ?? 0,
    implementedLinks: app.implementedLinks ?? 0,
    types: app.mechanismTypes ?? 0,
  },
  overlap: {
    clients: clients.overlap ?? clients.presentInBothSources,
    implementedClients: clients.overlapImplemented,
    links: links.duplicateCrossSource ?? links.overlapRemoved,
  },
  consolidated: {
    clientsWithMechanisms: totals.clients?.clientsWithMechanisms ?? payload.summary?.clientsWithMechanisms,
    clientsImplemented: totals.clients?.clientsWithImplementedMechanism ?? payload.summary?.clientsWithImplementedMechanism,
    implementedLinks: totals.links?.implementedLinks,
    types: types.consolidatedCatalog ?? payload.summary?.typesUsed,
    unusedTypes: types.unusedCatalog ?? payload.summary?.typesWithoutUsage,
    topMechanism: payload.summary?.mostUsedMechanism,
  },
  sanity: {
    expectedBaseQvClients: 441,
    expectedBaseQvImplemented: 421,
    baseQvClientsOk: base.clientsWithMechanisms === 441,
    baseQvImplementedOk: base.clientsWithImplementedMechanism === 421,
  },
};

console.log(JSON.stringify(report, null, 2));
