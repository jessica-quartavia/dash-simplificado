#!/usr/bin/env node
/**
 * Auditoria targeted V1 × V2 — Atualização Financeira + Acionamentos.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  financialUpdatesLeader,
  formatFinancialLeaderNote,
} from "../lib/analytics/financial-updates-metrics.mjs";

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

const RECENCY_BANDS = [
  "Atualizado nos últimos 30 dias",
  "De 31 a 60 dias",
  "De 61 a 90 dias",
  "De 91 a 180 dias",
  "Mais de 180 dias",
  "Sem data de atualização",
  "Sem dados financeiros",
];

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthSeries(rows, monthsBack = 6, now = new Date()) {
  const buckets = new Map();
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(monthKey(d), new Set());
  }
  const nowKey = monthKey(now);
  for (const row of rows || []) {
    if (!row.hasPostCreationUpdate || !row.financialUpdateDate) continue;
    const date = new Date(row.financialUpdateDate);
    if (Number.isNaN(date.getTime()) || date > now) continue;
    const key = monthKey(date);
    if (key > nowKey || !buckets.has(key)) continue;
    buckets.get(key).add(String(row.clientId));
  }
  return [...buckets.entries()].map(([month, set]) => ({ month, count: set.size }));
}

function recencyDist(rows) {
  const total = rows.length || 1;
  return RECENCY_BANDS.map((label) => ({
    label,
    count: rows.filter((r) => r.recencyBand === label).length,
    percent: Math.round((rows.filter((r) => r.recencyBand === label).length / total) * 1000) / 10,
  }));
}

function filterFinancialV1Like(clients, { status = "all" } = {}) {
  return clients.filter((c) => {
    if (status === "active" && c.analyticalStatus !== "Ativo") return false;
    if (status === "all") return true;
    return true;
  });
}

function supportFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

async function loadV1Financial() {
  const mod = await import(pathToFileURL(join(V1_ROOT, "financial-updates.mjs")).href);
  return mod.computeFinancialUpdatesPayload();
}

async function loadV2Financial() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/financial-updates.mjs")).href);
  return mod.computeFinancialUpdatesPayload();
}

async function loadV1Support() {
  const mod = await import(pathToFileURL(join(V1_ROOT, "support.mjs")).href);
  return mod.computeSupportPayload();
}

async function loadV2Support() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/support.mjs")).href);
  return mod.computeSupportPayload();
}

function delta(a, b) {
  if (a == null || b == null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return null;
  return Math.round((Number(b) - Number(a)) * 1000) / 1000;
}

function status(a, b) {
  return a === b ? "PASS" : "FIXED";
}

console.log("Carregando payloads live…");
const [v1Fin, v2Fin, v1Sup, v2Sup] = await Promise.all([
  loadV1Financial(),
  loadV2Financial(),
  loadV1Support(),
  loadV2Support(),
]);

const comparePresets = [
  { label: "Status=Todos (V1 default)", status: "all" },
  { label: "Status=Ativos (V2 default)", status: "active" },
];

for (const preset of comparePresets) {
  const v1Rows = filterFinancialV1Like(v1Fin.clients || [], preset);
  const v2Rows = filterFinancialV1Like(v2Fin.clients || [], preset);
  const v1Rec = recencyDist(v1Rows);
  const v2Rec = recencyDist(v2Rows);
  const v1Months = buildMonthSeries(v1Rows, 6);
  const v2Months = buildMonthSeries(v2Rows, 6);

  console.log(`\n### FINANCEIRO — ${preset.label}`);
  console.log("Recência | V1 | V2 | Delta | Status");
  for (const band of RECENCY_BANDS) {
    const a = v1Rec.find((r) => r.label === band)?.count ?? 0;
    const b = v2Rec.find((r) => r.label === band)?.count ?? 0;
    console.log(`${band} | ${a} | ${b} | ${delta(a, b)} | ${status(a, b)}`);
  }
  console.log("\nMês | V1 | V2 | Delta | Status");
  for (const item of v1Months) {
    const b = v2Months.find((m) => m.month === item.month)?.count ?? 0;
    console.log(`${item.month} | ${item.count} | ${b} | ${delta(item.count, b)} | ${status(item.count, b)}`);
  }
  if (preset.status === "active") {
    const leader = financialUpdatesLeader(v2Rows);
    console.log(`EP líder (V2): ${leader?.leaders?.join(" e ") || "—"} (${leader?.count ?? 0} atualizações)`);
    console.log(`Nota: ${formatFinancialLeaderNote(leader) || "—"}`);
  }
}

if (v1Sup && v2Sup) {
  const v1t = v1Sup.tickets || [];
  const v2t = v2Sup.tickets || [];
  const v1Summary = v1Sup.summary || {};
  const v2Summary = v2Sup.summary || {};
  const pri = ["Urgente", "Alta", "Média", "Baixa", "Não informado"];
  console.log("\n### ACIONAMENTOS — V1 × V2 (todos)");
  console.log("Métrica | V1 | V2 | Delta | Status");
  for (const [label, a, b] of [
    ["Total", v1Summary.totalTickets, v2Summary.totalTickets],
    ["Identificados", v1Summary.identifiedClients, v2Summary.identifiedClients],
    ["Urgentes", v1Summary.urgentTickets, v2Summary.urgentTickets],
    ["Reclamações", v1t.filter((t) => supportFold(`${t.type} ${t.title} ${t.description}`).includes("reclam")).length, v2t.filter((t) => supportFold(`${t.type} ${t.title} ${t.description}`).includes("reclam")).length],
    ["Elogios", v1t.filter((t) => supportFold(`${t.type} ${t.title} ${t.description}`).includes("elog")).length, v2t.filter((t) => supportFold(`${t.type} ${t.title} ${t.description}`).includes("elog")).length],
    ["Escalou (Urg/Alta)", v1t.filter((t) => ["Urgente", "Alta"].includes(t.priority)).length, v2t.filter((t) => ["Urgente", "Alta"].includes(t.priority)).length],
  ]) {
    console.log(`${label} | ${a ?? "—"} | ${b ?? "—"} | ${delta(a, b)} | ${status(a, b)}`);
  }
  console.log("\nPrioridade | V1 | V2 | Status");
  for (const p of pri) {
    const a = v1t.filter((t) => t.priority === p).length;
    const b = v2t.filter((t) => t.priority === p).length;
    console.log(`${p} | ${a} | ${b} | ${status(a, b)}`);
  }
} else {
  console.log("\n### ACIONAMENTOS — V1 BLOCKED (auth corporativa)");
  const v2Summary = v2Sup?.summary || {};
  console.log(`V2 total=${v2Summary.totalTickets} identificados=${v2Summary.identifiedClients} urgentes=${v2Summary.urgentTickets}`);
}

console.log("\nFim.");
