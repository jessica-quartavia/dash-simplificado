import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildMetricSnapshots } from "../../lib/analytics/snapshot/metric-snapshot-builder.mjs";
import { extractSnapshot, listExtractorMetricIds } from "../../lib/analytics/snapshot/metric-snapshot-registry.mjs";
import { findSnapshotPii } from "../../lib/analytics/snapshot/metric-snapshot-pii.mjs";
import { persistableSnapshotRows } from "../../lib/analytics/snapshot/metric-snapshot-store.mjs";
import { mockComputes } from "./snapshot-fixtures.mjs";

const seed = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json"), "utf8"),
);
const validated = seed.metrics.filter((m) => m.validated_for_v2 === true);

test("somente validated_for_v2 entra e total esperado = 49", async () => {
  const result = await buildMetricSnapshots({
    catalogRows: seed.metrics,
    computes: mockComputes(),
  });
  assert.equal(result.expected_total, 49);
  assert.equal(result.snapshots.length, 49);
  assert.equal(result.snapshots.every((row) => validated.some((m) => m.metric_id === row.metric_id)), true);
  assert.equal(result.counts.general, 19);
  assert.equal(result.counts.journey, 2);
  assert.equal(result.counts.meetings, 12);
  assert.equal(result.counts.patrimonial_plan, 1);
  assert.equal(result.counts.mechanisms, 15);
});

test("nenhuma métrica Avaliar ou Não Levar entra no snapshot", async () => {
  const result = await buildMetricSnapshots({
    catalogRows: seed.metrics,
    computes: mockComputes(),
  });
  const byId = new Map(seed.metrics.map((m) => [m.metric_id, m]));
  for (const row of result.snapshots) {
    const dash = String(byId.get(row.metric_id)?.dash_kids_status || "");
    assert.notEqual(dash.toLowerCase(), "avaliar");
    assert.equal(/n[aã]o levar/i.test(dash), false);
  }
});

test("snapshot sem PII", async () => {
  const result = await buildMetricSnapshots({ catalogRows: validated, computes: mockComputes() });
  assert.equal(findSnapshotPii(result.snapshots), null);
  const dirty = { clientName: "Ana", email: "ana@quartavia.com.br" };
  assert.ok(findSnapshotPii(dirty));
});

test("active_first e historical preservados", async () => {
  const result = await buildMetricSnapshots({ catalogRows: validated, computes: mockComputes() });
  const active = result.snapshots.find((row) => row.metric_id === "active_clients");
  const acquisition = result.snapshots.find((row) => row.metric_id === "client_acquisition_monthly");
  const plan = result.snapshots.find((row) => row.metric_id === "plan_days_to_approval");
  const total = result.snapshots.find((row) => row.metric_id === "total_clients");
  assert.equal(active.scope_key, "active");
  assert.equal(active.scope.status, "active");
  assert.equal(acquisition.scope_key, "historical");
  assert.equal(plan.scope_key, "historical");
  assert.equal(total.scope_key, "all");
});

test("coverage correta em clientes com mecanismos", async () => {
  const result = await buildMetricSnapshots({ catalogRows: validated, computes: mockComputes() });
  const row = result.snapshots.find((item) => item.metric_id === "clients_with_mechanisms");
  assert.equal(row.numerator, 77);
  assert.equal(row.denominator, 1775);
  assert.equal(row.coverage, 0.0434);
});

test("registry não recalcula regra", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/snapshot/metric-snapshot-registry.mjs"),
    "utf8",
  );
  assert.equal(src.includes("summarizeGeneralRows"), false);
  assert.equal(src.includes("summarizeMeetingRows"), false);
  assert.equal(src.includes("summarizeMechanismRows"), false);
  assert.equal(src.includes("computeGeneralDataPayload"), false);
});

test("erro não entra no UPSERT e não apaga último válido", () => {
  const kept = persistableSnapshotRows([
    { metric_id: "active_clients", calculation_status: "ok", value: { value: 10 } },
    { metric_id: "attendance_rate", calculation_status: "error", value: { value: null } },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].metric_id, "active_clients");
});

test("falha se faltar extractor", async () => {
  await assert.rejects(
    () => buildMetricSnapshots({
      catalogRows: [...validated, { metric_id: "ghost_metric", page_id: "general", validated_for_v2: true, scope_policy: "active_first" }],
      computes: mockComputes(),
    }),
    (error) => error.code === "missing_snapshot_extractor" && String(error.message).includes("ghost_metric"),
  );
});

test("comparação compute × snapshot na mesma execução", async () => {
  const result = await buildMetricSnapshots({ catalogRows: validated, computes: mockComputes() });
  const failed = result.comparison.filter((row) => !row.match);
  assert.deepEqual(failed, []);
});

test("extractors cobrem as 49 do catálogo", async () => {
  const computes = mockComputes();
  const ctx = {
    general: await computes.general(),
    meetings: await computes.meetings(),
    journey: await computes.journey(),
    patrimonial_plan: await computes.patrimonial_plan(),
    mechanisms: await computes.mechanisms(),
  };
  const missing = validated.filter((metric) => !extractSnapshot(metric, ctx[metric.page_id]));
  assert.deepEqual(missing.map((m) => m.metric_id), []);
  assert.equal(listExtractorMetricIds().length, 49);
});
