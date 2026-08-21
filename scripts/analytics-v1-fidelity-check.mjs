/**
 * Verifica metadata de métricas (docs/regras-metricas-dashboard.csv) vs registry V2.
 * Uso: node scripts/analytics-v1-fidelity-check.mjs [--page=cancellations]
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CSV_PATH = join(ROOT, "docs", "regras-metricas-dashboard.csv");
const pageFilter = process.argv.find((arg) => arg.startsWith("--page="))?.split("=")[1]?.trim() || null;

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current);
    const row = {};
    headers.forEach((header, index) => {
      row[header.trim()] = (cells[index] || "").trim();
    });
    return row;
  });
}

if (!existsSync(CSV_PATH)) {
  console.error(`CSV não encontrado: ${CSV_PATH}`);
  process.exit(1);
}

const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
const filtered = pageFilter
  ? rows.filter((row) => String(row.domain || "").toLowerCase() === pageFilter.toLowerCase())
  : rows;

const checks = filtered.map((row) => ({
  metric_id: row.metric_id,
  label: row.label,
  page: row.page,
  domain: row.domain,
  formula_csv: row.formula,
  unit: row.unit,
  source: row.sources_tables,
  supported_filters: row.supported_filters,
  registry_path: row.registry_payload_path,
  v2_status: row.in_registry === "yes" ? "registry" : row.in_catalog === "yes" ? "catalog" : "missing",
  match: row.metric_id && row.formula ? "PASS" : "FAIL",
}));

const summary = {
  total: checks.length,
  pass: checks.filter((c) => c.match === "PASS").length,
  fail: checks.filter((c) => c.match === "FAIL").length,
  pageFilter,
};

console.log(JSON.stringify({ summary, checks: checks.slice(0, pageFilter ? undefined : 50), truncated: !pageFilter && checks.length > 50 }, null, 2));
process.exitCode = summary.fail > 0 ? 1 : 0;
