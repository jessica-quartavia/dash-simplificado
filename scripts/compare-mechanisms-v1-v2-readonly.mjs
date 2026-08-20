/**
 * Comparação somente leitura V1 × V2 de Implementação de Mecanismos.
 * Não altera o banco. Não imprime segredos.
 *
 * Uso: node scripts/compare-mechanisms-v1-v2-readonly.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeMechanismsPayload, toPublicMechanismsPayload } from "../lib/analytics/mechanisms.mjs";
import { defaultMechanismFilters, filterMechanismClients, filterPortfolio, portfolioSize } from "../lib/analytics/mechanism-filters.mjs";
import { summarizeEngineerBars, summarizeMechanismRows } from "../lib/analytics/mechanism-metrics.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_PATH = resolve(
  ROOT,
  "..",
  "analytics_jornada_cliente",
  "analytics_jornada_cliente",
  "netlify",
  "functions",
  "mechanisms.mjs",
);

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

const merged = { ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) };
for (const [key, value] of Object.entries(merged)) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

function pickV2(payload, filters) {
  const rows = filterMechanismClients(payload.clients || [], filters);
  const portfolio = filterPortfolio(payload.portfolio || [], filters);
  const summary = summarizeMechanismRows(rows, {
    catalog: payload.catalog || [],
    portfolioCount: portfolioSize(portfolio),
  });
  const byEngineer = summarizeEngineerBars(rows, portfolio);
  return {
    clientesComMecanismos: summary.clientsWithMechanisms,
    tiposUsados: summary.typesUsed,
    tiposSemUso: summary.typesUnused,
    maisUtilizado: summary.topMechanismName,
    maisUtilizadoClientes: summary.topMechanismClients,
    implementados: summary.implementedMechanisms,
    emAndamento: summary.inProgressMechanisms,
    percentual: summary.implementationPercent,
    recentes: summary.recentClients,
    cobertura: summary.coverage,
    vinculos: summary.availableMechanisms,
    epTopo: byEngineer[0] || null,
  };
}

function pickV1(payload) {
  const s = payload?.summary || {};
  return {
    clientesComMecanismos: s.clientsWithMechanisms,
    tiposUsados: s.typesUsed,
    tiposSemUso: s.typesUnused,
    maisUtilizado: s.topMechanism?.name || s.topRecommended?.[0]?.name || null,
    maisUtilizadoClientes: s.topMechanism?.clientCount || s.topRecommended?.[0]?.clients || null,
    implementados: s.implementedMechanisms,
    emAndamento: s.inProgressMechanisms,
    percentual: s.implementationPercent,
    recentes: s.clientsWithRecentImplementation,
    cobertura: {
      sample: s.clientsWithMechanisms,
      total: s.portfolioClients,
      percent: s.mechanismCoveragePercent,
    },
    vinculos: s.availableMechanisms,
    defaultStatus: "all",
  };
}

const started = Date.now();
const v2Full = await computeMechanismsPayload();
const v2All = pickV2(v2Full, { ...defaultMechanismFilters(), status: "all" });
const v2Active = pickV2(v2Full, defaultMechanismFilters());
const publicV2 = toPublicMechanismsPayload(v2Full);

let v1 = null;
try {
  const mod = await import(pathToFileURL(V1_PATH).href);
  const v1Payload = await mod.computeMechanismsPayload();
  v1 = pickV1(v1Payload);
} catch (error) {
  v1 = { error: error instanceof Error ? error.message : String(error) };
}

console.log(JSON.stringify({
  ms: Date.now() - started,
  payloadV2PublicBytes: Buffer.byteLength(JSON.stringify(publicV2)),
  timingV2: v2Full.timing || null,
  v1AllClients: v1,
  v2AllClients: v2All,
  v2DefaultAtivos: v2Active,
  notas: [
    "Indicadores Sim do CSV: BASE QV (clients + client_mecanismos + mecanismos).",
    "App Pharus não é consultado na V2 desta página — o CSV não aprova métricas Pharus aqui.",
    "V1 compute abre na carteira inteira; a UI da V1 tinha chip opcional de ativos.",
    "V2 default = analyticalStatus Ativo. Congelado não é ativo.",
    "Não Levar omitidos: tempo médio até 1ª implementação, gráfico tempo até 1ª, gráfico dias desde a última.",
    "Igualdade esperada: recorte Todos da V2 × summary da V1 (mesma dedupe e status).",
    "Diferença intencional: V2 abre em Ativos, então cobertura e KPIs de clientes mudam de denominador.",
  ],
}, null, 2));
