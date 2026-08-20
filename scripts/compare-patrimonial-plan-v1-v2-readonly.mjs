/**
 * Comparação somente leitura V1 × V2 de Plano Patrimonial.
 * Não altera o banco. Não imprime segredos.
 *
 * Uso: node scripts/compare-patrimonial-plan-v1-v2-readonly.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePatrimonialPlanPayload,
  toPublicPatrimonialPlanPayload,
} from "../lib/analytics/patrimonial-plan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return parsed;
}

const merged = { ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) };
for (const [key, value] of Object.entries(merged)) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

const started = Date.now();
const v2 = await computePatrimonialPlanPayload({ excludeFuture: true, applyExclusions: true });
const v1Like = await computePatrimonialPlanPayload({ excludeFuture: false, applyExclusions: false });
const publicV2 = toPublicPatrimonialPlanPayload(v2);

console.log(JSON.stringify({
  ms: Date.now() - started,
  payloadV2PublicBytes: Buffer.byteLength(JSON.stringify(publicV2)),
  timingV2: v2.timing || null,
  v2: {
    populacao: v2.approvalTime.totalPopulation,
    elegiveis: v2.approvalTime.eligibleClients,
    tempoMedio: v2.approvalTime.value,
    cobertura: v2.approvalTime.coveragePercent,
    comReuniaoCentral: v2.approvalTime.withCentralMeeting,
  },
  v1LikeMesmaBase: {
    populacao: v1Like.approvalTime.totalPopulation,
    elegiveis: v1Like.approvalTime.eligibleClients,
    tempoMedio: v1Like.approvalTime.value,
    cobertura: v1Like.approvalTime.coveragePercent,
  },
  notas: [
    "V1 compute = média de dias não negativos entre data_inicio_ciclo/created_at e a última reunião Central de Inteligência.",
    "A UI da V1 reexibia mediana; a V2 segue o compute e o CSV (média).",
    "V2 exclui intervalo futuro; a V1 só exclui negativo.",
    "V2 aplica exclusões operacionais do kernel; a V1 desta página não aplicava.",
    "QV360 não entra: o handler publicado da V1 usa só BASE QV.",
  ],
}, null, 2));
