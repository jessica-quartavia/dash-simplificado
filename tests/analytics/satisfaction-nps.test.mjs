import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyNpsScore, computeNpsBreakdown, dedupeNpsResponses } from "../../lib/analytics/nps-metrics.mjs";
import {
  buildOfficialNpsProgramBreakdown,
  buildSatisfactionPayload,
  computeNpsScopeComparison,
} from "../../lib/analytics/satisfaction.mjs";
import { resolveSatisfactionNpsKpi } from "../../lib/analytics/satisfaction-metrics.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("classificação NPS — 9/10 promotor, 7/8 neutro, 0–6 detrator", () => {
  assert.equal(classifyNpsScore(10), "promoter");
  assert.equal(classifyNpsScore(9), "promoter");
  assert.equal(classifyNpsScore(8), "passive");
  assert.equal(classifyNpsScore(7), "passive");
  assert.equal(classifyNpsScore(6), "detractor");
  assert.equal(classifyNpsScore(0), "detractor");
});

test("null e nota inválida ignorados", () => {
  const breakdown = computeNpsBreakdown([null, undefined, "", 11, -1, NaN, 9]);
  assert.equal(breakdown.responses, 1);
  assert.equal(breakdown.promoters, 1);
  assert.equal(breakdown.nps, 100);
});

test("total = promotores + neutros + detratores e fórmula oficial", () => {
  const scores = [10, 9, 8, 7, 6, 5, 4];
  const breakdown = computeNpsBreakdown(scores);
  assert.equal(
    breakdown.responses,
    breakdown.promoters + breakdown.passives + breakdown.detractors,
  );
  assert.equal(
    breakdown.nps,
    Math.round((breakdown.promoterPct - breakdown.detractorPct) * 10) / 10,
  );
});

test("dedupe — última resposta por client_id (submitted_at desc)", () => {
  const { rows } = dedupeNpsResponses([
    { id: "1", client_id: "a", score: 6, submitted_at: "2026-01-01", created_at: "2026-01-01" },
    { id: "2", client_id: "a", score: 10, submitted_at: "2026-02-01", created_at: "2026-02-01" },
    { id: "3", client_id: "b", score: 8, submitted_at: "2026-01-15", created_at: "2026-01-15" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.clientId === "a").score, 10);
});

test("Pharus e Davos calculados separadamente; total não é média simples", () => {
  const clientMap = new Map([
    ["p1", { programa: "Pharus" }],
    ["p2", { programa: "Pharus" }],
    ["p3", { programa: "Pharus" }],
    ["d1", { programa: "Davos" }],
    ["d2", { programa: "Davos" }],
  ]);
  const rows = [
    { client_id: "p1", score: 10, submitted_at: "2026-01-01", created_at: "2026-01-01" },
    { client_id: "p2", score: 10, submitted_at: "2026-01-02", created_at: "2026-01-02" },
    { client_id: "p3", score: 10, submitted_at: "2026-01-05", created_at: "2026-01-05" },
    { client_id: "d1", score: 6, submitted_at: "2026-01-03", created_at: "2026-01-03" },
    { client_id: "d2", score: 5, submitted_at: "2026-01-04", created_at: "2026-01-04" },
  ];
  const { breakdown } = buildOfficialNpsProgramBreakdown(rows, clientMap);
  assert.equal(breakdown.pharus.n, 3);
  assert.equal(breakdown.davos.n, 2);
  assert.equal(breakdown.pharus.nps, 100);
  assert.equal(breakdown.davos.nps, -100);
  assert.equal(breakdown.total.nps, 20);
  const naiveAverage = (breakdown.pharus.nps + breakdown.davos.nps) / 2;
  assert.notEqual(breakdown.total.nps, naiveAverage);
  assert.equal(breakdown.pharus.n + breakdown.davos.n, breakdown.total.n);
});

test("respondentes por programa somam total quando Programa é exclusivo", () => {
  const clientMap = new Map([
    ["a", { programa: "Pharus" }],
    ["b", { programa: "Davos" }],
    ["c", { programa: "Outro" }],
  ]);
  const { breakdown } = buildOfficialNpsProgramBreakdown(
    [
      { client_id: "a", score: 10, submitted_at: "2026-01-01", created_at: "2026-01-01" },
      { client_id: "b", score: 6, submitted_at: "2026-01-02", created_at: "2026-01-02" },
      { client_id: "c", score: 8, submitted_at: "2026-01-03", created_at: "2026-01-03" },
    ],
    clientMap,
  );
  assert.equal(
    breakdown.pharus.n + breakdown.davos.n + breakdown.unknown.n,
    breakdown.total.n,
  );
});

test("payload headline usa regra oficial, não trimestre", () => {
  const payload = buildSatisfactionPayload({
    clients: [
      { id: "1", codigo: "A", name: "Ana", status: "Ativo", programa: "Pharus" },
      { id: "2", codigo: "B", name: "Bob", status: "Ativo", programa: "Davos" },
    ],
    clientMap: new Map([
      ["1", { id: "1", codigo: "A", name: "Ana", status: "Ativo", programa: "Pharus" }],
      ["2", { id: "2", codigo: "B", name: "Bob", status: "Ativo", programa: "Davos" }],
    ]),
    npsRowsRaw: [
      { id: "n1", client_id: "1", score: 10, created_at: "2025-01-01", submitted_at: "2025-01-01", typeform_response_id: "r1" },
      { id: "n2", client_id: "1", score: 6, created_at: "2026-02-01", submitted_at: "2026-02-01", typeform_response_id: "r2" },
      { id: "n3", client_id: "2", score: 9, created_at: "2026-02-15", submitted_at: "2026-02-15", typeform_response_id: "r3" },
    ],
    csatRowsRaw: [],
    npsSends: [],
  });
  assert.equal(payload.summary.nps, 0);
  assert.equal(payload.summary.npsDistinctClients, 2);
  assert.equal(payload.benchmarks.total.n, 2);
  assert.match(payload.methodology.npsRule, /submitted_at desc/);
  assert.ok(payload.summary.quarterScopedNps != null);
});

test("resolveSatisfactionNpsKpi — filteredNps vs benchmarks total", () => {
  const payload = {
    population: { totalClients: 100 },
    benchmarks: {
      total: { n: 10, nps: 65, promoters: 8, neutrals: 1, detractors: 1 },
      pharus: { n: 7, nps: 70, promoters: 6, neutrals: 0, detractors: 1 },
      davos: { n: 3, nps: 40, promoters: 2, neutrals: 1, detractors: 0 },
    },
  };
  const global = resolveSatisfactionNpsKpi(payload, {});
  assert.equal(global.nps, 65);
  const filtered = resolveSatisfactionNpsKpi(payload, { filteredNps: payload.benchmarks.pharus });
  assert.equal(filtered.nps, 70);
});

test("escopos A–E expostos para diagnóstico", () => {
  const scopes = computeNpsScopeComparison(
    [
      { client_id: "1", score: 10, created_at: "2026-01-01", submitted_at: "2026-01-01" },
      { client_id: "1", score: 6, created_at: "2026-02-01", submitted_at: "2026-02-01" },
    ],
    new Map([["1", { programa: "Pharus" }]]),
    [{ quarter: "2026 T1" }],
  );
  assert.equal(scopes.length, 5);
  assert.equal(scopes[1].n, 1);
  assert.equal(scopes[3].n, 1);
});

test("UI — legenda benchmarks Pharus/Davos com tooltip", () => {
  const source = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(source, /formatNpsSublegend\(benchmarks\)/);
  assert.match(source, /kpi-sublegend/);
  assert.match(source, /respostas/);
});
