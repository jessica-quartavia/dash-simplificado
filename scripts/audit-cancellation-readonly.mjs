/**
 * Diagnóstico read-only de cancelamento efetivado (regra oficial V1/V2).
 * Uso: node scripts/audit-cancellation-readonly.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCancellationsPayload } from "../lib/analytics/cancellations.mjs";
import { getAnalyticalCancellation, isDistratoTextSigned } from "../lib/analytics/analytical-cancellation.mjs";

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

const payload = await computeCancellationsPayload();
const audit = payload.quality?.effectiveCancellationAudit || {};
const summary = payload.summary || {};
const evidence = summary.evidenceFunnel || [];

console.log(
  JSON.stringify(
    {
      effectiveCancellation: {
        totalDistinct: audit.totalDistinct,
        byEvidence: {
          onlyChurnEfetivadoAt: audit.onlyChurnEfetivadoAt,
          onlyDistratoAssinadoAt: audit.onlyDistratoAssinadoAt,
          onlyDistratoTextSigned: audit.onlyDistratoTextSigned,
          onlyClientDataChurn: audit.onlyClientDataChurn,
          multipleSources: audit.multipleSources,
        },
        overlapCancelAndDataChurn: audit.overlapCancelAndDataChurn,
        effectiveWithoutConfirmedDate: audit.effectiveWithoutConfirmedDate,
        naoAssinadoRule: isDistratoTextSigned("Não assinado") === false,
      },
      intentionPedido: {
        intentionsRegistered: summary.intentionsRegistered,
        ordersRegistered: summary.ordersRegistered,
        intentionsOrOrdersRegistered: summary.intentionsOrOrdersRegistered,
        effectiveCancellations: summary.effectiveCancellations,
        clientsInCancellationProcess: summary.clientsInCancellationProcess,
        activeWithCancellationIntention: summary.activeWithCancellationIntention,
        effectiveWithoutConfirmedDate: summary.effectiveWithoutConfirmedDate,
        archivedRecords: summary.archivedRecords,
      },
      funnels: {
        evidenceFunnel: evidence.map((e) => ({ label: e.label || e.key, count: e.count, note: e.note })),
        evidenceNotSummable: true,
      },
      goldenRule: "INTENÇÃO/PEDIDO NÃO TIRAM CLIENTE DA CARTEIRA ATIVA",
    },
    null,
    2,
  ),
);
