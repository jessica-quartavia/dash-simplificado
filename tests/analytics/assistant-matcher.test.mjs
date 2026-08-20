import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  detectIntent,
  matchMetrics,
  MATCH_THRESHOLD,
} from "../../lib/assistant/metric-matcher.mjs";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/metric-catalog-seed.json");
const catalog = JSON.parse(readFileSync(SEED_PATH, "utf8")).metrics;

function topMatch(question) {
  const result = matchMetrics(question, catalog);
  return {
    intent: result.intent,
    metric_id: result.matches[0]?.metric_id || null,
    score: result.matches[0]?.score || 0,
    matches: result.matches,
  };
}

function assertMatch(question, expectedMetricId) {
  const { metric_id, score } = topMatch(question);
  assert.ok(score >= MATCH_THRESHOLD, `score baixo (${score}) para "${question}" → ${metric_id}`);
  assert.equal(metric_id, expectedMetricId, `"${question}" → ${metric_id}, esperado ${expectedMetricId}`);
}

test("matching — clientes e carteira", () => {
  assertMatch("quantos clientes ativos temos?", "active_clients");
  assertMatch("qual a regra de clientes ativos?", "active_clients");
  assertMatch("qual o total de clientes?", "total_clients");
  assertMatch("qual a permanência média?", "median_stay_days");
  assertMatch("qual a renda mensal?", "median_monthly_income");
});

test("matching — reuniões", () => {
  assertMatch("quantas reuniões temos?", "total_meetings");
  assertMatch("qual a taxa de comparecimento?", "attendance_rate");
  assertMatch("quantos no-shows?", "no_show_meetings");
  assertMatch("quais os tipos de reunião?", "top_meeting_types");
});

test("matching — onboarding e plano", () => {
  assertMatch("quem concluiu onboarding?", "onboarding_completion_chart");
  assertMatch("quanto tempo leva o onboarding?", "total_onboarding_time_chart");
  assertMatch("quanto tempo até aprovação?", "plan_days_to_approval");
});

test("matching — mecanismos", () => {
  assertMatch("quantos mecanismos foram implementados?", "implemented_mechanisms");
  assertMatch("qual percentual implementado?", "implementation_rate");
  assertMatch("qual mecanismo mais utilizado?", "most_used_mechanism");
  assertMatch("onde vejo mecanismos implementados?", "implemented_mechanisms");
});

test("matching — comparecimento por localização", () => {
  const { metric_id } = topMatch("onde vejo taxa de comparecimento?");
  assert.equal(metric_id, "attendance_rate");
});

test("matching — métrica não validada V2", () => {
  const { metric_id, score } = topMatch("qual a taxa de renovação?");
  assert.equal(metric_id, "renewal_rate");
  assert.ok(score >= MATCH_THRESHOLD);
  const metric = catalog.find((row) => row.metric_id === "renewal_rate");
  assert.equal(metric.validated_for_v2, false);
});

test("matching — fora do domínio", () => {
  const { matches } = topMatch("qual ação devo comprar?");
  assert.equal(matches.length, 0);
});

test("intent — heurísticas", () => {
  assert.equal(detectIntent("quanto temos?"), "value");
  assert.equal(detectIntent("como é calculado?"), "rule");
  assert.equal(detectIntent("de onde vem?"), "source");
  assert.equal(detectIntent("onde encontro?"), "location");
  assert.equal(detectIntent("tem alguma limitação?"), "limitation");
});
