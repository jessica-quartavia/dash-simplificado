#!/usr/bin/env node
/**
 * Auditoria targeted V1 × V2 — Mecanismos, Plano Patrimonial, Program Filter Check.
 *
 *   node scripts/compare-v1-v2-mechanisms-plan.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareMechanismsPrograms,
  comparePlanApproval,
  summarizeMechanismsForProgram,
} from "../lib/analytics/targeted-fidelity.mjs";
import { runProgramFilterCheck } from "../lib/analytics/program-filter-check.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const V1_ROOT = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions");

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

async function loadV1(name) {
  return import(pathToFileURL(join(V1_ROOT, `${name}.mjs`)).href);
}

async function loadV2(name) {
  return import(pathToFileURL(join(ROOT, `lib/analytics/${name}.mjs`)).href);
}

console.log("Carregando payloads live…");
const t0 = Date.now();
const [
  v1PlanMod,
  v2PlanMod,
  v2MechanismsMod,
  v2GeneralMod,
  v2OnboardingMod,
  v2MeetingsMod,
  v2FinancialMod,
  v2SatisfactionMod,
  v2CancelMod,
  v2RenewalMod,
  v2EpMod,
  v2TemporalMod,
] = await Promise.all([
  loadV1("patrimonial-plan"),
  loadV2("patrimonial-plan"),
  loadV2("mechanisms"),
  loadV2("general-data"),
  loadV2("onboarding"),
  loadV2("meetings"),
  loadV2("financial-updates"),
  loadV2("satisfaction"),
  loadV2("cancellations"),
  loadV2("renewal"),
  loadV2("ep-performance"),
  loadV2("temporal-indicators"),
]);

const [v1PlanRaw, v2Plan, v2Mechanisms, general, journey, meetings, financial, satisfaction, cancellations, renewal, ep, temporal] =
  await Promise.all([
    (async () => {
      try {
        const handler = v1PlanMod.default;
        if (!handler) return { clients: [] };
        const resp = await handler(new Request("http://local/api/patrimonial-plan"));
        if (!resp.ok) return { clients: [] };
        const body = await resp.json();
        return { clients: body?.payload?.clients || body?.clients || [] };
      } catch {
        return { clients: [] };
      }
    })(),
    v2PlanMod.computePatrimonialPlanPayload(),
    v2MechanismsMod.computeMechanismsPayload().then((p) => v2MechanismsMod.toPublicMechanismsPayload(p)),
    v2GeneralMod.computeGeneralDataPayload(),
    v2OnboardingMod.computeOnboardingPayload(),
    v2MeetingsMod.computeMeetingsPayload({ includeMeetingTypes: false }),
    v2FinancialMod.computeFinancialUpdatesPayload(),
    v2SatisfactionMod.computeSatisfactionPayload(),
    v2CancelMod.computeCancellationsPayload(),
    v2RenewalMod.computeRenewalPayload(),
    v2EpMod.computeEpPerformancePayload(),
    v2TemporalMod.computeTemporalIndicatorsPayload(),
  ]);

const v1Plan = v1PlanRaw;

console.log(`Compute ${Math.round((Date.now() - t0) / 1000)}s\n`);

console.log("### MECANISMOS — por Programa (V2 live, default Ativos)");
const mechByProgram = compareMechanismsPrograms(v2Mechanisms);
console.log("Programa | Com mech. | BASE | App | Impl. clientes | Vínculos impl. | Em and. | % impl.");
for (const row of mechByProgram) {
  console.log(
    `${row.program} | ${row.clientsWithMechanisms} | ${row.baseQv} | ${row.appPharus} | ${row.clientsImplemented} | ${row.linksImplemented} | ${row.inProgress} | ${row.implementationRate ?? "—"}%`,
  );
}

const pharusSlice = summarizeMechanismsForProgram(v2Mechanisms, "Pharus");
console.log("\nPharus slice detail:");
console.log(`  filtered canonical rows: ${pharusSlice.rows.length}`);
console.log(`  app-only rows: ${pharusSlice.rows.filter((r) => String(r.clientId).startsWith("pharus:")).length}`);
console.log(`  deduplicatedUniquePeople (quality): ${pharusSlice.summary.deduplicatedUniquePeople ?? "—"}`);

console.log("\n### PLANO PATRIMONIAL — Tempo até aprovação (V1 mediana UI × V2)");
for (const program of ["all", "Pharus", "Davos"]) {
  const cmp = comparePlanApproval(v1Plan, v2Plan, program);
  console.log(
    `${program}: V1 mediana=${cmp.v1Median} (N=${cmp.v1N}) · V2 mediana=${cmp.v2Median} (N=${cmp.v2N}) · delta=${cmp.delta} · ${cmp.status}`,
  );
}

console.log("\n### PROGRAM FILTER CHECK");
const checks = runProgramFilterCheck({
  general,
  journey,
  onboarding: journey,
  meetings,
  patrimonial_plan: v2Plan,
  mechanisms: v2Mechanisms,
  financial_updates: financial,
  satisfaction,
  cancellations,
  renewal,
  ep_performance: ep,
  temporal_indicators: temporal,
});
console.log("Página | Todos | Pharus | Davos | Não informado | Status");
for (const row of checks) {
  console.log(`${row.page} | ${row.todos} | ${row.pharus} | ${row.davos} | ${row.naoInformado} | ${row.status}`);
}

console.log("\nFim.");
