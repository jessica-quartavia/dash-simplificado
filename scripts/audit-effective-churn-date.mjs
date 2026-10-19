/**
 * Auditoria DEV — effective_churn_date (read-only BASE QV).
 * Uso: node scripts/audit-effective-churn-date.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    parsed[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return parsed;
}

for (const [k, v] of Object.entries(parseEnvFile(resolve(root, ".env")))) {
  if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
}

import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import { runWithAnalyticsDataContext } from "../lib/analytics/analytics-data-context.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
  auditEffectiveChurnDateAdjustments,
  buildAnalyticalCancellationMap,
} from "../lib/analytics/analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "../lib/analytics/data-exclusions.mjs";

const CLIENT_SELECT = "id,data_fim_ciclo";
const outJson = resolve(root, "exports/audit_effective_churn_date.json");
const outCsv = resolve(root, "exports/audit_effective_churn_date.csv");

async function main() {
  await runWithAnalyticsDataContext(async () => {
    const [clientsRaw, cancellationsRaw] = await Promise.all([
      fetchAllRows({ table: "clients", select: CLIENT_SELECT }),
      fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT }),
    ]);
    const removedIds = excludedClientIds(clientsRaw);
    const clients = filterExcludedClients(clientsRaw);
    const cancellations = cancellationsRaw.filter((row) => !removedIds.has(String(row.client_id || "")));
    const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
    const audit = auditEffectiveChurnDateAdjustments(clients, cancelMap);
    writeFileSync(outJson, JSON.stringify({ summary: audit.summary, rows: audit.rows }, null, 2), "utf8");
    const header = "client_id,original_churn_date,data_fim_ciclo,effective_churn_date,adjusted\n";
    const body = audit.rows
      .map((r) =>
        [r.client_id, r.original_churn_date, r.data_fim_ciclo, r.effective_churn_date, r.adjusted].join(","),
      )
      .join("\n");
    writeFileSync(outCsv, header + body, "utf8");
    console.log(JSON.stringify(audit.summary, null, 2));
    console.log(`Wrote ${outCsv}`);
  }, { page: "audit-effective-churn" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
