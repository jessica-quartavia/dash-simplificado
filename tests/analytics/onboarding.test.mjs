import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyClientAnalyticalStatus } from "../../lib/analytics/analytical-cancellation.mjs";
import {
  classifyOnboardingCompletion,
  OPEN_ONBOARDING_STAGE_IDS,
} from "../../lib/analytics/onboarding-completion.mjs";
import {
  defaultOnboardingFilters,
  filterOnboardingClients,
} from "../../lib/analytics/onboarding-filters.mjs";
import {
  isComparableOnboardingRow,
  median,
  ONBOARDING_HIDDEN_CHARTS,
  ONBOARDING_VISIBLE_CHARTS,
  summarizeOnboardingRows,
} from "../../lib/analytics/onboarding-metrics.mjs";
import { buildOnboardingPayload, toPublicOnboardingPayload, validOnboardingDays } from "../../lib/analytics/onboarding.mjs";
import { resolveClientFirstMeeting } from "../../lib/analytics/meeting-metrics.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");
const OPEN_STAGE = [...OPEN_ONBOARDING_STAGE_IDS][0];

test("default Status = Ativos", () => {
  const filters = defaultOnboardingFilters();
  assert.equal(filters.status, "active");
  const clients = [
    { clientId: "1", clientName: "Ana", analyticalStatus: "Ativo", engineer: "EP1", completedOnboarding: true },
    { clientId: "2", clientName: "Bruno", analyticalStatus: "Congelado", engineer: "EP1", completedOnboarding: true },
    { clientId: "3", clientName: "Carla", analyticalStatus: "Cancelado", engineer: "EP2", completedOnboarding: false },
  ];
  const rows = filterOnboardingClients(clients, filters);
  assert.deepEqual(rows.map((r) => r.clientId), ["1"]);
});

test("status analítico vem do kernel, não do bruto", () => {
  const classified = classifyClientAnalyticalStatus("ativo", {
    isCancelled: true,
    hasConfirmedDate: true,
    date: new Date("2026-01-01"),
    source: "churn_efetivado_at",
  });
  assert.equal(classified.analyticalStatus, "Cancelado");
  const payload = buildOnboardingPayload({
    clients: [{ id: "1", name: "Ana", status: "ativo", data_inicio_ciclo: "2025-01-01" }],
    cancellations: [{
      client_id: "1",
      churn_efetivado_at: "2026-01-10",
      archived_at: null,
    }],
    calendlyRows: [],
    manualRows: [],
    attendanceRows: [],
    implRows: [],
    journeys: [],
    financialRows: [],
    mechanisms: [],
    now,
  });
  assert.equal(payload.clients[0].rawStatus, "ativo");
  assert.equal(payload.clients[0].analyticalStatus, "Cancelado");
});

test("conclusão: estágio aberto sem reunião nem financeiro = não", () => {
  const result = classifyOnboardingCompletion({
    latestStageId: OPEN_STAGE,
    hasFirstMeeting: false,
    hasFinancialData: false,
  });
  assert.equal(result.completedOnboarding, false);
  assert.equal(result.completedByJourney, false);
});

test("conclusão: primeira reunião ou financeiro ou estágio fechado = sim", () => {
  assert.equal(classifyOnboardingCompletion({ latestStageId: "closed-stage" }).completedOnboarding, true);
  assert.equal(classifyOnboardingCompletion({ hasFirstMeeting: true }).completedOnboarding, true);
  assert.equal(classifyOnboardingCompletion({ hasFinancialData: true }).completedOnboarding, true);
});

test("conclusão: sem jornada, reunião e financeiro = não avaliável", () => {
  const result = classifyOnboardingCompletion({});
  assert.equal(result.completedOnboarding, null);
});

test("filtro de conclusão recorta Sim / Não / não avaliável", () => {
  const clients = [
    { clientId: "1", clientName: "Ana", analyticalStatus: "Ativo", engineer: "EP1", completedOnboarding: true },
    { clientId: "2", clientName: "Bruno", analyticalStatus: "Ativo", engineer: "EP1", completedOnboarding: false },
    { clientId: "3", clientName: "Carla", analyticalStatus: "Ativo", engineer: "EP1", completedOnboarding: null },
  ];
  assert.equal(filterOnboardingClients(clients, { status: "active", completion: "yes" }).length, 1);
  assert.equal(filterOnboardingClients(clients, { status: "active", completion: "no" })[0].clientId, "2");
  assert.equal(filterOnboardingClients(clients, { status: "active", completion: "unevaluable" })[0].clientId, "3");
});

test("mediana ignora intervalos negativos", () => {
  assert.equal(median([10, -4, 20, null]), 15);
  const start = new Date("2026-02-01T00:00:00.000Z");
  const earlier = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(validOnboardingDays(start, earlier, now), null);
  assert.equal(isComparableOnboardingRow({
    totalOnboardingDays: 10,
    daysToFirstMeeting: -2,
    daysToPlanDelivery: 20,
  }), false);
});

test("primeira reunião usa o helper existente (sem futura, pré-entrada ou negativo)", () => {
  const entry = new Date("2026-01-10T00:00:00.000Z");
  const result = resolveClientFirstMeeting({
    annotatedMeetings: [
      { startTime: "2025-12-01T12:00:00.000Z", attendanceStatus: "compareceu", meetingDateStatus: "before_client_entry" },
      { startTime: "2026-12-01T12:00:00.000Z", attendanceStatus: "compareceu", meetingDateStatus: "future" },
    ],
    entryDate: entry,
    now,
  });
  assert.equal(result.firstMeetingCompleted, false);
  assert.equal(result.daysFromEntryToFirstMeeting, null);
});

test("cobertura é calculada sobre a população filtrada", () => {
  const rows = [
    { completedOnboarding: true, totalOnboardingDays: 8, daysToFirstMeeting: 10, daysToPlanDelivery: 20, daysToFirstImplementation: null },
    { completedOnboarding: true, totalOnboardingDays: null, daysToFirstMeeting: null, daysToPlanDelivery: null, daysToFirstImplementation: null },
  ];
  const summary = summarizeOnboardingRows(rows);
  assert.equal(summary.comparableCoverage.sample, 1);
  assert.equal(summary.comparableCoverage.total, 2);
  assert.equal(summary.comparableCoverage.percent, 50);
  assert.equal(summary.completionCoverage.percent, 100);
});

test("selects de jornada e mecanismo usam colunas reais da BASE QV", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../lib/analytics/onboarding.mjs"), "utf8");
  const journey = src.match(/const JOURNEY_SELECT = "([^"]+)"/)?.[1];
  const mechanism = src.match(/const MECHANISM_SELECT = "([^"]+)"/)?.[1];
  assert.equal(journey, "id,client_id,current_stage_id,started_at,created_at");
  assert.equal(mechanism, "id,client_id,status,implemented_at,created_at");
});

test("gráfico de primeiro mecanismo não entra na UI", () => {
  assert.ok(ONBOARDING_HIDDEN_CHARTS.includes("firstImplementation"));
  assert.ok(!ONBOARDING_VISIBLE_CHARTS.includes("firstImplementation"));
  const ui = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../js/onboarding.js"), "utf8");
  assert.equal(ui.includes("obChartFirstImplementation"), false);
  assert.equal(/Dias at[eé] primeiro mecanismo implementado/i.test(ui), false);
  assert.equal(ui.includes("Mediana até 1º mecanismo"), true);
  const publicPayload = toPublicOnboardingPayload({
    clients: [{
      clientId: "1",
      daysToFirstImplementation: 40,
      firstImplementationDate: "2026-03-01T00:00:00.000Z",
    }],
  });
  assert.equal("firstImplementationRanges" in publicPayload, false);
  assert.equal("distributions" in publicPayload, false);
});

test("buildOnboardingPayload expõe summary.completedOnboarding para auditoria", () => {
  const payload = buildOnboardingPayload({
    now,
    clients: [{ id: "1", codigo: "A1", name: "Ana", status: "ativo", data_inicio_ciclo: "2026-01-01" }],
    calendlyRows: [{ client_id: "1", start_time: "2026-02-01T12:00:00.000Z", event_name: "Reunião" }],
    manualRows: [],
    attendanceRows: [{ calendly_event_uri: "x", status: "compareceu" }],
    implRows: [],
    cancellations: [],
    journeys: [],
    financialRows: [],
    mechanisms: [],
  });
  assert.equal(typeof payload.summary?.completedOnboarding, "number");
  assert.equal(payload.summary.completedOnboarding, payload.clients.filter((r) => r.completedOnboarding === true).length);
});
