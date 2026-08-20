/**
 * Comparação somente leitura V1 × V2 de Dados Gerais.
 * Não altera o banco. Não imprime PII nem segredos.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { computeGeneralDataPayload } from "../lib/analytics/general-data.mjs";
import { summarizeGeneralRows, distributionsFromRows } from "../lib/analytics/general-metrics.mjs";
import { filterGeneralClients } from "../lib/analytics/general-filters.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

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

const merged = {
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
};
for (const [key, value] of Object.entries(merged)) process.env[key] = value;

function pick(summary, dist) {
  return {
    total: summary.totalClients,
    ativos: summary.activeClients,
    congelados: summary.frozenClients,
    cancelados: summary.cancelledClients,
    marcadosSemConfirmacao: summary.cancelledWithoutConfirmedDate,
    naoInformado: summary.unknownClients,
    permanenciaMediana: summary.typicalStayDays,
    liquidezMediana: summary.typicalLiquidityReserve,
    rendaMediana: summary.typicalMonthlyIncome,
    aporteMediana: summary.typicalLastContribution,
    status: Object.fromEntries((dist.status || []).map((i) => [i.label, i.count])),
    segmentos: Object.fromEntries((dist.segments || []).map((i) => [i.label, i.count])),
    topEp: (dist.engineers || []).slice(0, 5).map((i) => ({ label: i.label, count: i.count })),
  };
}

const v2 = await computeGeneralDataPayload();
const all = pick(v2.summary, v2.distributions);
const activeRows = filterGeneralClients(v2.clients, { status: "active" });
const active = pick(summarizeGeneralRows(activeRows), distributionsFromRows(activeRows));

let v1 = null;
const v1Path = resolve(
  ROOT,
  "..",
  "analytics_jornada_cliente",
  "analytics_jornada_cliente",
  "netlify",
  "functions",
  "general-data.mjs",
);
try {
  const mod = await import(pathToFileURL(v1Path).href);
  const v1Payload = await mod.computeGeneralDataPayload();
  v1 = pick(v1Payload.summary, v1Payload.distributions);
} catch (error) {
  v1 = { error: error instanceof Error ? error.message : String(error) };
}

console.log(JSON.stringify({ population: "all (igualdade)", v1, v2: all, v2ActiveDefault: active }, null, 2));
