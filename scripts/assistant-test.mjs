#!/usr/bin/env node
/**
 * Teste manual do Assistente V2 (pode chamar Gemini real).
 * Não imprime GEMINI_API_KEY. Não faz parte do suite automatizado.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAssistant } from "../lib/assistant/assistant-service.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
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

for (const [key, value] of Object.entries({ ...parseEnvFile(join(ROOT, ".env")), ...parseEnvFile(join(ROOT, ".env.local")) })) {
  if (!process.env[key]) process.env[key] = value;
}

const questions = process.argv.slice(2);
const defaults = [
  "quantos clientes ativos temos?",
  "quantas reuniões temos?",
  "quantos clientes ativos do EP Nícolas Alves?",
];

function printReport(message, result) {
  const body = result.body || {};
  const meta = body.meta || {};
  const metric = body.matched_metrics?.[0]?.metric_id || "—";
  const timings = meta.timings_ms || {};
  console.log(`Question: ${message}`);
  console.log(`Metric: ${metric}`);
  console.log(`Intent: ${body.intent || "—"}`);
  console.log(`Filters: ${JSON.stringify(body.filters || {})}`);
  console.log(`Value source: ${meta.value_source || "—"}`);
  console.log(`Value: ${body.answer?.slice(0, 160) || "—"}`);
  console.log(`Compute page: ${meta.compute_page || "—"}`);
  console.log(`Cache hit: ${meta.compute_cache_hit ? "sim" : "não"}`);
  console.log(`Snapshot: ${meta.used_snapshot ? "sim" : "não"} | Compute: ${meta.used_compute ? "sim" : "não"} | Gemini: ${meta.used_gemini ? "sim" : "não"}`);
  console.log(`Context bytes: ${meta.context_bytes ?? 0}`);
  console.log(
    `Timings ms: catalog=${timings.catalogMs ?? "—"} match=${timings.matchMs ?? "—"} snapshot=${timings.snapshotMs ?? "—"} compute=${timings.computeMs ?? "—"} gemini=${timings.geminiMs ?? "—"} total=${timings.totalMs ?? "—"}`,
  );
  console.log("---");
}

async function main() {
  const accessToken = process.env.ANALYTICS_ACCESS_TOKEN || "";
  const list = questions.length ? questions : defaults;

  for (const message of list) {
    const started = Date.now();
    const result = await runAssistant({ message, accessToken });
    if (!result.body?.meta?.timings_ms) result.body.meta = result.body.meta || {};
    result.body.meta.timings_ms = {
      ...(result.body.meta.timings_ms || {}),
      totalMs: Date.now() - started,
    };
    printReport(message, result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
