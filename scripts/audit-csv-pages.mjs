/**
 * Audita classificações Dash Kids do CSV mais recente para páginas EP/Temporal/Estatística.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const downloads = join(process.env.USERPROFILE || "", "Downloads");
const candidates = [
  join(ROOT, "sql", "analytics", "source", "confiabilidade-indicadores-pagina1.csv"),
  ...readdirSync(downloads)
    .filter((n) => /confiabilidade.*pagina.*\.csv$/i.test(n))
    .map((n) => join(downloads, n)),
].filter((p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
});

candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const csvPath = candidates[0];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((c) => c.trim())) rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return { header, rows: rows.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""]))) };
}

const text = readFileSync(csvPath, "utf8");
const { rows } = parseCsv(text);
const pageCol = "Página do dashboard";
const dashCol = "Dash Kids";
const pages = [
  "Performance do Engenheiro Patrimonial",
  "Indicadores Temporais",
  "Análises Estatísticas",
];

console.log(JSON.stringify({ csvPath, totalRows: rows.length, allPages: [...new Set(rows.map((r) => r[pageCol]))] }, null, 2));

const audit = {};
for (const page of pages) {
  const subset = rows.filter((r) => (r[pageCol] || "").trim() === page);
  const counts = {};
  for (const r of subset) {
    const s = (r[dashCol] || "").trim() || "(sem classificação)";
    counts[s] = (counts[s] || 0) + 1;
  }
  audit[page] = {
    total: subset.length,
    counts,
    items: subset.map((r) => ({
      name: r["Cartão / gráfico"],
      type: r["Tipo"],
      dashKids: (r[dashCol] || "").trim() || null,
    })),
  };
}

console.log(JSON.stringify(audit, null, 2));
