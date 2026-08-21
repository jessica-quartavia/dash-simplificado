#!/usr/bin/env node
/**
 * Auditoria global V1 × V2 — compute live, bypass cache.
 *
 * Uso:
 *   node scripts/compare-v1-v2-all-pages.mjs
 *   node scripts/compare-v1-v2-all-pages.mjs --page=mechanisms
 *   node scripts/compare-v1-v2-all-pages.mjs --page=mechanisms --page=cancellations
 */
import { runFullAudit, writeAuditReport } from "../lib/analytics/fidelity-audit.mjs";

function parseArgs(argv) {
  const pages = [];
  let write = true;
  for (const arg of argv) {
    if (arg.startsWith("--page=")) pages.push(arg.slice("--page=".length));
    else if (arg === "--no-write") write = false;
  }
  return { pages: pages.length ? pages : null, write };
}

const { pages, write } = parseArgs(process.argv.slice(2));
const report = await runFullAudit({ pages });
console.log(JSON.stringify({ totals: report.totals, slowest: report.slowest }, null, 2));
if (write) {
  const paths = writeAuditReport(report);
  console.error(`Relatório: ${paths.mdPath}`);
  console.error(`JSON: ${paths.jsonPath}`);
}
