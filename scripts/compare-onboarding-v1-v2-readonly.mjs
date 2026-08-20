/**
 * Comparação somente leitura V1 × V2 de Jornada e Onboarding.
 * Não altera o banco. Não imprime segredos.
 *
 * Uso: node scripts/compare-onboarding-v1-v2-readonly.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeOnboardingPayload as computeV2, toPublicOnboardingPayload } from "../lib/analytics/onboarding.mjs";
import { filterOnboardingClients } from "../lib/analytics/onboarding-filters.mjs";
import { summarizeOnboardingRows, distributionsFromOnboardingRows } from "../lib/analytics/onboarding-metrics.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_PATH = resolve(
  ROOT,
  "..",
  "analytics_jornada_cliente",
  "analytics_jornada_cliente",
  "netlify",
  "functions",
  "onboarding.mjs",
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

function pickV2(rows) {
  const summary = summarizeOnboardingRows(rows);
  const dist = distributionsFromOnboardingRows(rows);
  return {
    populacao: summary.totalClients,
    concluiram: summary.completedOnboarding,
    naoConcluiram: summary.openOnboarding,
    percentual: summary.completedPercent,
    medianaOnboarding: summary.medianTotalOnboardingDays,
    medianaPrimeiraReuniao: summary.medianFirstMeetingDays,
    medianaPlano: summary.medianPlanDeliveryDays,
    medianaMecanismo: summary.medianFirstImplementationDays,
    coberturaComparavel: summary.comparableCoverage,
    coberturaConclusao: summary.completionCoverage,
    coberturaPrimeiraReuniao: summary.firstMeetingCoverage,
    coberturaPlano: summary.planDeliveryCoverage,
    coberturaMecanismo: summary.firstImplementationCoverage,
    coberturaTempoTotalBruta: summary.totalOnboardingCoverage,
    tempoTotal: Object.fromEntries((dist.totalOnboarding || []).map((i) => [i.label, i.count])),
  };
}

const started = Date.now();
const v2Full = await computeV2();
const v2All = pickV2(v2Full.clients);
const v2Active = pickV2(filterOnboardingClients(v2Full.clients, { status: "active" }));

let v1 = null;
try {
  const mod = await import(pathToFileURL(V1_PATH).href);
  const v1Payload = await mod.computeOnboardingPayload();
  v1 = {
    populacao: v1Payload.summary.totalClients,
    concluiram: v1Payload.summary.completedOnboarding,
    naoConcluiram: v1Payload.summary.openOnboarding,
    percentual: v1Payload.summary.completedPercent,
    medianaOnboarding: v1Payload.summary.averageTotalOnboardingDays,
    medianaPrimeiraReuniao: v1Payload.summary.averageFirstMeetingDays,
    medianaPlano: v1Payload.summary.averagePlanDeliveryDays,
    medianaMecanismo: v1Payload.summary.averageFirstImplementationDays,
    coberturaComparavel: {
      sample: v1Payload.summary.journeyKpiComparableClients,
      total: v1Payload.summary.totalClients,
      percent: v1Payload.summary.totalOnboardingCoveragePercent,
    },
    tempoTotal: Object.fromEntries(
      (v1Payload.distributions.totalOnboardingRanges || []).map((i) => [i.label, i.count]),
    ),
  };
} catch (error) {
  v1 = { error: error instanceof Error ? error.message : String(error) };
}

const publicV2 = toPublicOnboardingPayload(v2Full);
console.log(JSON.stringify({
  ms: Date.now() - started,
  payloadV2PublicBytes: Buffer.byteLength(JSON.stringify(publicV2)),
  timingV2: v2Full.timing || null,
  v1AllClients: v1,
  v2AllClients: v2All,
  v2DefaultAtivos: v2Active,
  v2Warnings: v2Full?.metadata?.warnings || [],
  notas: [
    "V1 classifica status bruto e não aplica active-first no compute.",
    "V2 usa analyticalStatus do kernel; o default da página é Ativos.",
    "V2 reutiliza a primeira reunião de Reuniões (presença confirmada); a V1 onboarding usa o min(start_time).",
    "V2 descarta marco futuro; a V1 só descarta intervalo negativo.",
  ],
}, null, 2));
