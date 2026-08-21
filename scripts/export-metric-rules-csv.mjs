/**
 * Exporta docs/regras-metricas-dashboard.csv a partir do seed do catálogo V2.
 * Fonte de auditoria V1/V2 — não altera computes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "lib", "analytics", "metric-catalog-seed.json");
const OUT_DIR = join(ROOT, "docs");
const OUT_PATH = join(OUT_DIR, "regras-metricas-dashboard.csv");

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(values) {
  return values.map(csvEscape).join(",");
}

const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
const headers = [
  "metric_id",
  "label",
  "domain",
  "page",
  "description",
  "formula",
  "aggregation",
  "allowed_aggregations",
  "unit",
  "status",
  "official_for_chatbot",
  "realtime_live_query",
  "execution_kind",
  "executor",
  "executor_compute_file",
  "summary_field",
  "registry_payload_path",
  "registry_sample_size_path",
  "registry_definition",
  "registry_count_from_clients",
  "supported_filters",
  "sources_schema_table_column",
  "sources_tables",
  "sources_columns",
  "aliases",
  "limitations",
  "page_hint",
  "questions",
  "legacy_ids_pointing_here",
  "in_catalog",
  "in_registry",
  "notes_technical",
];

const lines = [row(headers)];
for (const m of seed.metrics || []) {
  const sources = Array.isArray(m.source_objects) ? m.source_objects : [];
  lines.push(row([
    m.metric_id,
    m.label,
    m.page_id,
    m.page_label,
    m.description,
    m.calculation_summary,
    m.aggregation || "",
    (m.allowed_aggregations || []).join("|"),
    m.unit,
    m.dash_kids_status || (m.validated_for_v2 ? "validated_v2" : ""),
    m.validated_for_v2 ? "yes" : "no",
    m.realtime_live_query ? "yes" : "no",
    m.execution_kind || "",
    m.executor || "",
    m.executor_compute_file || "",
    m.summary_field || "",
    m.registry_payload_path || "",
    m.registry_sample_size_path || "",
    m.registry_definition || "",
    m.registry_count_from_clients ? "yes" : "no",
    (m.supported_filters || []).join("|"),
    sources.map((s) => `${s.schema || "public"}.${s.object}.${s.column}`).join("|"),
    sources.map((s) => s.object).filter(Boolean).join("|"),
    sources.map((s) => s.column).filter(Boolean).join("|"),
    (m.aliases || []).join("|"),
    m.limitations || "",
    m.page_hint || "",
    (m.questions || []).join("|"),
    (m.legacy_ids_pointing_here || []).join("|"),
    "yes",
    m.validated_for_v2 ? "yes" : "no",
    m.v1_reference || m.csv_reference || "",
  ]));
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ out: OUT_PATH, rows: lines.length - 1 }, null, 2));
