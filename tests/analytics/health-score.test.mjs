import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHealthScoreAnalysis,
  classifyHealthScore,
  computeFinalHealthScore,
  DEFAULT_MECHANISM_SLIDER,
  enrichHealthScoreClients,
  isHealthScoreNoData,
  mechanismScoreFromHas,
  meetingScoresFromCounts,
  normalizeHealthScoreWeights,
  weightsFromMechanismSlider,
} from "../../lib/analytics/health-score-metrics.mjs";
import {
  defaultHealthScoreFilters,
  filterHealthScoreBaseClients,
  filterHealthScoreClients,
} from "../../lib/analytics/health-score-filters.mjs";
import { buildHealthScorePayload } from "../../lib/analytics/health-score.mjs";
import { buildAnalyticalPopulation } from "../../lib/analytics/statistical-crosses.mjs";
import { getPageFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";

const mockGeneral = {
  clients: [
    {
      clientId: "1",
      clientName: "Alice",
      clientCode: "A1",
      engineer: "EP1",
      program: "Pharus",
      analyticalStatus: "Ativo",
      hireDate: "2025-01-01",
      stayDays: 365,
    },
    {
      clientId: "2",
      clientName: "Bob",
      clientCode: "B1",
      engineer: "EP2",
      program: "Davos",
      analyticalStatus: "Ativo",
      hireDate: "2025-01-01",
      stayDays: 365,
    },
    {
      clientId: "3",
      clientName: "Carol",
      clientCode: "C1",
      engineer: "EP1",
      program: "Pharus",
      analyticalStatus: "Cancelado",
      hireDate: "2024-01-01",
      stayDays: 200,
    },
    {
      clientId: "4",
      clientName: "Dan",
      clientCode: "D1",
      engineer: "EP2",
      program: "Pharus",
      analyticalStatus: "Ativo",
      hireDate: "2025-06-01",
      stayDays: 120,
    },
  ],
};

const mockMeetings = {
  clients: [
    { clientId: "1", totalMeetings: 10 },
    { clientId: "2", totalMeetings: 2 },
    { clientId: "3", totalMeetings: 5 },
    { clientId: "4", totalMeetings: 0 },
  ],
};

const mockMechanisms = {
  clients: [
    { clientId: "1", available: 2 },
    { clientId: "2", available: 1 },
    { clientId: "3", available: 0 },
    { clientId: "4", available: 0 },
  ],
};

test("slider controla peso de mecanismos e soma sempre 1", () => {
  const cases = [
    { slider: 0, meetings: 100, mechanism: 0 },
    { slider: 0.5, meetings: 50, mechanism: 50 },
    { slider: 1, meetings: 0, mechanism: 100 },
    { slider: 0.25, meetings: 75, mechanism: 25 },
    { slider: 0.75, meetings: 25, mechanism: 75 },
  ];
  for (const item of cases) {
    const w = weightsFromMechanismSlider(item.slider);
    assert.equal(w.meetings, item.meetings, `meetings @ ${item.slider}`);
    assert.equal(w.mechanism, item.mechanism, `mechanism @ ${item.slider}`);
    assert.equal(w.mechanismSlider, item.slider);
    const meetingWeight = 1 - w.mechanismSlider;
    assert.equal(Math.round((meetingWeight + w.mechanismSlider) * 100) / 100, 1);
  }
  assert.equal(DEFAULT_MECHANISM_SLIDER, 0.5);
  assert.deepEqual(normalizeHealthScoreWeights({}), { meetings: 50, mechanism: 50, mechanismSlider: 0.5 });
});

test("score final usa pesoReunioes = 1 - slider e pesoMecanismos = slider", () => {
  assert.equal(computeFinalHealthScore(80, 100, weightsFromMechanismSlider(0.3)), 86);
  assert.equal(computeFinalHealthScore(100, 100, weightsFromMechanismSlider(0.5)), 100);
  assert.equal(computeFinalHealthScore(20, 0, weightsFromMechanismSlider(0.3)), 14);
});

test("casos exemplo A/B/C com thresholds do protótipo", () => {
  assert.equal(classifyHealthScore(100), "healthy");
  assert.equal(classifyHealthScore(65), "attention");
  assert.equal(classifyHealthScore(14), "critical");
  assert.equal(computeFinalHealthScore(100, 100, weightsFromMechanismSlider(0.7)), 100);
  assert.equal(computeFinalHealthScore(50, 100, weightsFromMechanismSlider(0.3)), 65);
  assert.equal(computeFinalHealthScore(20, 0, weightsFromMechanismSlider(0.3)), 14);
});

test("possui mecanismo é binário — não usa quantidade", () => {
  assert.equal(mechanismScoreFromHas(true), 100);
  assert.equal(mechanismScoreFromHas(false), 0);
  const enriched = enrichHealthScoreClients(
    [
      { clientId: "1", meetingCount: 5, hasMechanism: true },
      { clientId: "2", meetingCount: 5, hasMechanism: false },
    ],
    weightsFromMechanismSlider(0.5),
  );
  assert.equal(enriched[0].mechanismScore, 100);
  assert.equal(enriched[1].mechanismScore, 0);
});

test("sem dados não vira crítico", () => {
  assert.equal(isHealthScoreNoData({ meetingCount: 0, hasMechanism: false }), true);
  const enriched = enrichHealthScoreClients([{ clientId: "x", meetingCount: 0, hasMechanism: false }]);
  assert.equal(enriched[0].classification, "no_data");
  assert.equal(enriched[0].healthScore, null);
});

test("percentil de reuniões respeita ordem crescente", () => {
  const scores = meetingScoresFromCounts([0, 2, 10]);
  assert.equal(scores[0], 0);
  assert.equal(scores[2], 100);
  assert.ok(scores[1] > scores[0] && scores[1] < scores[2]);
});

test("buildHealthScorePayload usa features oficiais meetingCount e hasMechanism", () => {
  const payload = buildHealthScorePayload({
    general: mockGeneral,
    meetings: mockMeetings,
    mechanisms: mockMechanisms,
  });
  const alice = payload.clients.find((c) => c.clientId === "1");
  const dan = payload.clients.find((c) => c.clientId === "4");
  assert.equal(alice.meetingCount, 10);
  assert.equal(alice.hasMechanism, true);
  assert.equal(dan.meetingCount, 0);
  assert.equal(dan.hasMechanism, false);

  const { clients } = buildAnalyticalPopulation(mockGeneral, mockMeetings, mockMechanisms, new Date());
  const fromPopulation = clients.find((c) => String(c.clientId) === "1");
  assert.equal(alice.meetingCount, fromPopulation.meetingCount);
  assert.equal(alice.hasMechanism, fromPopulation.hasMechanism);
});

test("filtros recalculam população — status Ativo default", () => {
  const payload = buildHealthScorePayload({
    general: mockGeneral,
    meetings: mockMeetings,
    mechanisms: mockMechanisms,
  });
  assert.equal(defaultHealthScoreFilters().status, "active");
  const activeOnly = filterHealthScoreBaseClients(payload.clients, defaultHealthScoreFilters());
  assert.equal(activeOnly.length, 3);
  const pharus = filterHealthScoreBaseClients(payload.clients, { ...defaultHealthScoreFilters(), program: "Pharus" });
  assert.equal(pharus.length, 2);
});

test("filtro classificação após enrich", () => {
  const analysis = buildHealthScoreAnalysis(
    [
      { clientId: "1", clientName: "A", analyticalStatus: "Ativo", meetingCount: 10, hasMechanism: true },
      { clientId: "2", clientName: "B", analyticalStatus: "Ativo", meetingCount: 0, hasMechanism: false },
    ],
    weightsFromMechanismSlider(0.7),
  );
  const criticalOnly = filterHealthScoreClients(analysis.clients, {
    ...defaultHealthScoreFilters(),
    classification: "no_data",
  });
  assert.equal(criticalOnly.length, 1);
  assert.equal(criticalOnly[0].clientId, "2");
});

test("contrato de filtros expõe busca, EP, programa, status e classificação", () => {
  const contract = getPageFilterContract("health_score");
  assert.deepEqual(contract.uiFilters, ["search", "status", "engineer", "program", "classification"]);
});

test("buildHealthScoreAnalysis ordena clientes por score crescente", () => {
  const analysis = buildHealthScoreAnalysis(
    [
      { clientId: "1", clientName: "Alto", meetingCount: 10, hasMechanism: true },
      { clientId: "2", clientName: "Baixo", meetingCount: 1, hasMechanism: false },
      { clientId: "3", clientName: "Medio", meetingCount: 4, hasMechanism: true },
    ],
    weightsFromMechanismSlider(0.7),
  );
  const scorable = analysis.clients.filter((c) => c.healthScore != null);
  assert.ok(scorable[0].healthScore <= scorable[scorable.length - 1].healthScore);
});
