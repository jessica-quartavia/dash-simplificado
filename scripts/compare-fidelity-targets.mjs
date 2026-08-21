#!/usr/bin/env node
/**
 * Auditoria targeted V1 × V2 — fidelidade das métricas prioritárias.
 *
 * Uso:
 *   node scripts/compare-fidelity-targets.mjs
 */
import { runFullAudit, writeAuditReport } from "../lib/analytics/fidelity-audit.mjs";

const TARGET_PAGES = [
  "satisfaction",
  "cancellations",
  "renewal",
  "mechanisms",
  "temporal_indicators",
  "executive_summary",
];

const report = await runFullAudit({ pages: TARGET_PAGES });
const paths = writeAuditReport(report, { basename: "fidelity-targets-audit" });
console.log(JSON.stringify({ totals: report.totals, pages: TARGET_PAGES }, null, 2));
console.error(`Relatório: ${paths.mdPath}`);
console.error(`JSON: ${paths.jsonPath}`);
