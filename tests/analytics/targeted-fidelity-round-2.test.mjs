import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildNpsProgramBreakdown } from "../../lib/analytics/satisfaction.mjs";
import {
  formatMeetingFiltersAudit,
  MEETINGS_FILTER_PRESETS,
  summarizeMeetingSetDiffCauses,
} from "../../lib/analytics/meetings-fidelity.mjs";
import {
  closeOpenDropdown,
  getOpenDropdown,
  registerOpenDropdown,
  shouldCloseDropdownForEvent,
} from "../../js/components/dropdown-coordinator.js";
import { renderStatisticalInsightBlock } from "../../js/components/statistical-insight.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function calcNps(scores) {
  const valid = scores.filter((score) => score != null);
  if (!valid.length) return null;
  const promoters = valid.filter((score) => score >= 9).length;
  const detractors = valid.filter((score) => score <= 6).length;
  const pct = (part, total) => Math.round((part / total) * 1000) / 10;
  return pct(promoters, valid.length) - pct(detractors, valid.length);
}

test("NPS fórmula oficial — promotores% − detratores%", () => {
  assert.equal(calcNps([10, 10, 10, 6, 5]), 20);
  assert.equal(calcNps([6, 5, 4]), -100);
});

test("NPS por programa soma respondentes exclusivos", () => {
  const clientMap = new Map([
    ["a", { programa: "Pharus" }],
    ["b", { programa: "Davos" }],
    ["c", { programa: "Outro" }],
  ]);
  const rows = [
    { client_id: "a", score: 10 },
    { client_id: "b", score: 6 },
    { client_id: "c", score: 8 },
  ];
  const breakdown = buildNpsProgramBreakdown(rows, clientMap);
  assert.equal(breakdown.total.n, 3);
  assert.equal(breakdown.pharus.n + breakdown.davos.n + breakdown.unknown.n, 3);
});

test("meetings — audit de filtros inclui campos pedidos", () => {
  const audit = formatMeetingFiltersAudit(MEETINGS_FILTER_PRESETS.v2_ui_default.filters);
  assert.ok("status" in audit);
  assert.ok("program" in audit);
  assert.ok("period" in audit);
  assert.ok("noShow" in audit);
});

test("meetings — causas de diff de meeting set", () => {
  const counts = summarizeMeetingSetDiffCauses([
    { meetingDateStatus: "future", side: "v1" },
    { source: "manual", side: "v2" },
  ]);
  assert.ok(Object.keys(counts).length >= 1);
});

test("dropdown coordinator — click outside fecha", () => {
  let closed = false;
  const trigger = { id: "t" };
  const panel = { id: "p" };
  registerOpenDropdown({
    close: () => {
      closed = true;
    },
    containsEvent: (event) => event?.target === trigger || event?.target === panel,
  });
  assert.equal(
    shouldCloseDropdownForEvent(getOpenDropdown(), { target: { id: "outside" } }),
    true,
  );
  closeOpenDropdown();
  assert.equal(closed, true);
});

test("insights estatísticos — compacto com um botão abrir e um ocultar", () => {
  const html = renderStatisticalInsightBlock({
    sectionId: "test",
    insight: "Texto principal.",
    evidence: ["E1"],
    interpretation: "I",
    action: "A",
    limitations: ["L"],
  });
  assert.match(html, /sc-insight-compact/);
  assert.match(html, /sc-insight-toggle--open/);
  assert.match(html, /sc-insight-toggle--close/);
});

test("dropdown global listener registrado", () => {
  const source = readFileSync(join(ROOT, "js/components/dropdown-coordinator.js"), "utf8");
  assert.match(source, /pointerdown/);
  assert.match(source, /containsEvent/);
});

test("satisfaction NPS sublegend no card", () => {
  const source = readFileSync(join(ROOT, "js/satisfaction.js"), "utf8");
  assert.match(source, /kpi-sublegend/);
  assert.match(source, /formatNpsSublegend/);
});

test("platform population parity blocked sem auth.users", () => {
  const source = readFileSync(join(ROOT, "lib/analytics/platform-usage.mjs"), "utf8");
  assert.match(source, /populationParityStatus/);
  assert.match(source, /PHARUS_SUPABASE_SERVICE_ROLE_KEY/);
});
