import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPharusClientCrosswalk,
  buildMonthWindow,
  collectTemporalMeetingKeys,
  meetingCompositeKey,
  mechanismImplemented,
  LOGIN_EVENTS,
  eventName,
} from "../../lib/analytics/temporal-indicators.mjs";
import { summarizeFilteredTemporal } from "../../lib/analytics/temporal-indicators-filters.mjs";

test("cross-source: union = base + app-only subjects", () => {
  const cross = {
    baseClients: 3428,
    appPharusUsers: 426,
    matchedIntoBase: 365,
    appOnlySubjects: 61,
    unionTotal: 3489,
  };
  assert.equal(cross.baseClients + cross.appOnlySubjects, cross.unionTotal);
  assert.equal(cross.appPharusUsers, cross.matchedIntoBase + cross.appOnlySubjects);
  assert.equal(cross.baseClients + cross.appPharusUsers - cross.matchedIntoBase, cross.unionTotal);
});

test("meetingCompositeKey dedupe por minuto+título", () => {
  const date = new Date("2026-01-15T14:30:00.000Z");
  const a = meetingCompositeKey("c1", date, "Reunião EP");
  const b = meetingCompositeKey("c1", date, "reuniao ep");
  assert.equal(a, b);
});

test("collectTemporalMeetingKeys exclui canceladas e duplicatas", () => {
  const months = buildMonthWindow(12);
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = `${month}-15T10:00:00.000Z`;
  const result = collectTemporalMeetingKeys({
    months,
    clientMeetings: [
      { client_id: "c1", start_time: start, event_name: "EP", calendly_event_uri: "u1" },
      { client_id: "c1", start_time: start, event_name: "EP", calendly_event_uri: "u2" },
    ],
    manualMeetings: [],
    attendanceByUri: new Map([["u2", "cancelled"]]),
  });
  assert.equal(result.total, 1);
  assert.ok(result.skipped.some((s) => s.reason === "duplicate" || s.reason === "cancelled"));
});

test("mechanismImplemented usa implemented_at ou status concluído", () => {
  assert.ok(mechanismImplemented({ implemented_at: "2026-01-01T00:00:00.000Z", status: "ativo" }));
  assert.ok(mechanismImplemented({ implemented_at: null, status: "concluido", created_at: "2026-02-01T00:00:00.000Z" }));
  assert.equal(mechanismImplemented({ implemented_at: null, status: "ativo", created_at: "2026-02-01T00:00:00.000Z" }), null);
});

test("LOGIN_EVENTS aceita login_succeeded e login_success", () => {
  assert.equal(LOGIN_EVENTS.includes(eventName({ event_name: "login_succeeded" })), true);
  assert.equal(LOGIN_EVENTS.includes(eventName({ event_name: "login_success" })), true);
});

test("buildPharusClientCrosswalk linked_user_id único", () => {
  const clients = [{ id: "base-1", linked_user_id: "ph-1", email: "a@test.com", cpf_digits: "", phone_digits: "" }];
  const profiles = new Map([["ph-1", { name: "User", email: "a@test.com", cpf: "", phone: "" }]]);
  const { byUserId, reasonByUserId } = buildPharusClientCrosswalk(clients, profiles);
  assert.equal(byUserId.get("ph-1"), "base-1");
  assert.equal(reasonByUserId.get("ph-1"), "linked_user_id");
});

test("summarizeFilteredTemporal repassa totalImplementations e cross-source", () => {
  const payload = {
    summary: {
      totalSubjects: 3489,
      baseClients: 3428,
      appPharusUsers: 426,
      totalLogins: 5231,
      totalMeetings: 6977,
      totalImplementations: 1086,
      totalFinancialUpdates: 3060,
      totalNpsResponses: 292,
      lastMonthDaysWithoutActivity: 70,
      loginEventsSource: "metrics.events",
      crossSource: { unionTotal: 3489 },
    },
    activityRecency: [{ subjectId: "1", source: "BASE QV", status: "ativo" }],
    preCancellation: { clients: [], signals: [] },
    activeRisk: { clients: [], signals: [] },
  };
  const view = summarizeFilteredTemporal(payload, {});
  assert.equal(view.summary.totalImplementations, 1086);
  assert.equal(view.summary.baseClients, 3428);
  assert.equal(view.summary.lastMonthDaysWithoutActivity, 70);
});
