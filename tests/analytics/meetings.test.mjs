import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMeetingFilters,
  defaultMeetingFilters,
} from "../../lib/analytics/meeting-filters.mjs";
import {
  classifyMeetingDate,
  clientHasMeeting,
  isConfirmedNoShow,
  isNoShowEligible,
  normalizeAttendanceStatus,
  recencySecondaryNote,
  resolveClientFirstMeeting,
  resolveMeetingsViewKind,
  summarizeMeetingRows,
} from "../../lib/analytics/meeting-metrics.mjs";
import { buildMeetingsPayload, toPublicClientDetail, toPublicMeetingsPayload } from "../../lib/analytics/meetings.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");

function meeting(partial) {
  return {
    meetingId: partial.meetingId || "m1",
    source: "calendly",
    title: "Checkpoint",
    startTime: "2026-06-01T12:00:00.000Z",
    attendanceStatus: "compareceu",
    rescheduled: false,
    meetingDateStatus: "valid",
    ...partial,
  };
}

test("default Status = Ativos", () => {
  const filters = defaultMeetingFilters();
  assert.equal(filters.status, "active");
  const clients = [
    { clientId: "1", clientName: "Ana", analyticalStatus: "Ativo", engineer: "EP1", meetings: [meeting({})], hasValidMeeting: true, firstMeetingCompleted: true, absences: 0, reschedules: 0, frequencyBand: "1 reunião" },
    { clientId: "2", clientName: "Bruno", analyticalStatus: "Congelado", engineer: "EP1", meetings: [meeting({ meetingId: "m2" })], hasValidMeeting: true, firstMeetingCompleted: true, absences: 0, reschedules: 0, frequencyBand: "1 reunião" },
    { clientId: "3", clientName: "Carla", analyticalStatus: "Cancelado", engineer: "EP2", meetings: [], hasValidMeeting: false, firstMeetingCompleted: false, absences: 0, reschedules: 0, frequencyBand: "Nenhuma" },
  ];
  const rows = applyMeetingFilters(clients, filters, { now });
  assert.deepEqual(rows.map((r) => r.clientId), ["1"]);
});

test("denominador usa a população filtrada, não a carteira total", () => {
  const clients = [
    { clientId: "1", clientName: "Ana", analyticalStatus: "Ativo", engineer: "EP1", meetings: [meeting({})], hasValidMeeting: true, firstMeetingCompleted: true, absences: 0, reschedules: 0, lastMeetingDate: "2026-06-01T12:00:00.000Z", daysSinceLastMeeting: 79, frequencyBand: "1 reunião" },
    { clientId: "2", clientName: "Bruno", analyticalStatus: "Ativo", engineer: "EP1", meetings: [], hasValidMeeting: false, firstMeetingCompleted: false, absences: 0, reschedules: 0, frequencyBand: "Nenhuma" },
    { clientId: "3", clientName: "Carla", analyticalStatus: "Cancelado", engineer: "EP1", meetings: [], hasValidMeeting: false, firstMeetingCompleted: false, absences: 0, reschedules: 0, frequencyBand: "Nenhuma" },
  ];
  const active = applyMeetingFilters(clients, defaultMeetingFilters(), { now });
  const all = applyMeetingFilters(clients, { ...defaultMeetingFilters(), status: "all" }, { now });
  const activeSummary = summarizeMeetingRows(active, { now });
  const allSummary = summarizeMeetingRows(all, { now });
  assert.equal(activeSummary.filteredClients, 2);
  assert.equal(activeSummary.clientsWithMeeting, 1);
  assert.equal(activeSummary.clientsWithoutMeeting, 1);
  assert.equal(activeSummary.meetingCoverageRate, 50);
  assert.equal(allSummary.filteredClients, 3);
  assert.equal(allSummary.meetingCoverageRate, 33.3);
  assert.notEqual(activeSummary.meetingCoverageRate, allSummary.meetingCoverageRate);
});

test("reunião cancelada não é no-show automaticamente", () => {
  assert.equal(normalizeAttendanceStatus("cancelada"), "cancelada");
  assert.equal(normalizeAttendanceStatus("canceled"), "cancelada");
  const cancelled = meeting({
    attendanceStatus: "cancelada",
    startTime: "2026-06-01T12:00:00.000Z",
  });
  assert.equal(isNoShowEligible(cancelled, now), false);
  assert.equal(isConfirmedNoShow(cancelled, now), false);
  const summary = summarizeMeetingRows(
    [{ meetings: [cancelled], absences: 0, reschedules: 0, hasValidMeeting: true, firstMeetingCompleted: false }],
    { now },
  );
  assert.equal(summary.cancelledMeetings, 1);
  assert.equal(summary.noShowsEligible, 0);
  assert.equal(summary.eligibleMeetings, 0);
});

test("reunião futura não entra como falta/no-show", () => {
  const future = meeting({
    attendanceStatus: "nao_compareceu",
    startTime: "2026-12-01T12:00:00.000Z",
    meetingDateStatus: "future",
  });
  assert.equal(classifyMeetingDate(new Date(future.startTime), new Date("2024-01-01"), now), "future");
  assert.equal(isConfirmedNoShow(future, now), false);
  const summary = summarizeMeetingRows(
    [{ meetings: [future], absences: 0, reschedules: 0, hasValidMeeting: true, firstMeetingCompleted: false }],
    { now },
  );
  assert.equal(summary.futureMeetings, 1);
  assert.equal(summary.noShowsEligible, 0);
  assert.equal(summary.eligibleMeetings, 0);
});

test("primeira reunião ignora pré-entrada, futura e valores negativos", () => {
  const entry = new Date("2024-01-10T00:00:00.000Z");
  const annotated = [
    meeting({ meetingId: "pre", startTime: "2024-01-05T12:00:00.000Z", meetingDateStatus: "before_client_entry" }),
    meeting({ meetingId: "first", startTime: "2024-01-20T12:00:00.000Z", meetingDateStatus: "valid" }),
    meeting({ meetingId: "future", startTime: "2026-12-01T12:00:00.000Z", meetingDateStatus: "future" }),
  ];
  const first = resolveClientFirstMeeting({ annotatedMeetings: annotated, entryDate: entry, now });
  assert.equal(first.firstMeetingCompleted, true);
  assert.equal(first.firstMeetingDate, "2024-01-20T12:00:00.000Z");
  assert.equal(first.daysFromEntryToFirstMeeting, 10);

  const onlyPre = resolveClientFirstMeeting({
    annotatedMeetings: [annotated[0]],
    entryDate: entry,
    now,
  });
  assert.equal(onlyPre.firstMeetingCompleted, false);
  assert.equal(onlyPre.firstMeetingStatus, "only_pre_entry_meetings");
  assert.equal(onlyPre.daysFromEntryToFirstMeeting, null);
});

test("filtros alteram o resultado", () => {
  const clients = [
    { clientId: "1", clientName: "Ana", analyticalStatus: "Ativo", engineer: "EP1", meetings: [meeting({ attendanceStatus: "compareceu" })], hasValidMeeting: true, firstMeetingCompleted: true, absences: 0, reschedules: 0, frequencyBand: "1 reunião" },
    { clientId: "2", clientName: "Bruno", analyticalStatus: "Ativo", engineer: "EP2", meetings: [meeting({ meetingId: "m2", attendanceStatus: "nao_compareceu" })], hasValidMeeting: true, firstMeetingCompleted: false, absences: 1, reschedules: 0, frequencyBand: "1 reunião" },
  ];
  const byEp = applyMeetingFilters(clients, { ...defaultMeetingFilters(), engineer: "EP2" }, { now });
  const byAbsence = applyMeetingFilters(clients, { ...defaultMeetingFilters(), absence: "yes" }, { now });
  const byFirst = applyMeetingFilters(clients, { ...defaultMeetingFilters(), first: "yes" }, { now });
  assert.deepEqual(byEp.map((r) => r.clientId), ["2"]);
  assert.deepEqual(byAbsence.map((r) => r.clientId), ["2"]);
  assert.deepEqual(byFirst.map((r) => r.clientId), ["1"]);
});

test("erro sai do loading mesmo com loading=true", () => {
  assert.equal(resolveMeetingsViewKind({ loading: true, error: "falhou", payload: null, errorCode: "error" }), "error");
  assert.equal(resolveMeetingsViewKind({ loading: true, error: null, payload: null }), "loading");
  assert.equal(resolveMeetingsViewKind({ loading: false, error: null, payload: { clients: [] } }), "empty");
  assert.equal(resolveMeetingsViewKind({ loading: false, errorCode: "AUTH_REQUIRED", payload: null }), "unauthorized");
});

test("payload: no-show e primeira reunião seguem a regra da V1", () => {
  const payload = buildMeetingsPayload({
    now,
    clients: [
      { id: "1", name: "Ana", status: "Ativo", engenheiro_patrimonial: "EP1", data_inicio_ciclo: "2024-01-10", created_at: "2024-01-01" },
    ],
    calendlyRows: [
      { id: "pre", client_id: "1", event_name: "Kickoff", start_time: "2024-01-05T12:00:00.000Z", calendly_event_uri: "uri-pre" },
      { id: "ok", client_id: "1", event_name: "Checkpoint", start_time: "2024-02-01T12:00:00.000Z", calendly_event_uri: "uri-ok" },
      { id: "cancel", client_id: "1", event_name: "Especial", start_time: "2024-03-01T12:00:00.000Z", calendly_event_uri: "uri-cancel" },
      { id: "future", client_id: "1", event_name: "Rota", start_time: "2026-12-01T12:00:00.000Z", calendly_event_uri: "uri-future" },
    ],
    manualRows: [],
    attendanceRows: [
      { calendly_event_uri: "uri-pre", status: "compareceu" },
      { calendly_event_uri: "uri-ok", status: "compareceu" },
      { calendly_event_uri: "uri-cancel", status: "cancelada" },
      { calendly_event_uri: "uri-future", status: "nao_compareceu" },
    ],
    implRows: [],
    cancellations: [],
  });
  const client = payload.clients[0];
  assert.equal(client.firstMeetingDate, "2024-02-01T12:00:00.000Z");
  assert.equal(client.firstMeetingCompleted, true);
  assert.equal(payload.summary.noShowsEligible, 0);
  assert.equal(payload.summary.cancelledMeetings, 1);
  assert.equal(payload.summary.futureMeetings, 1);
  assert.ok(!JSON.stringify(payload.clients).includes("cpf"));
});

test("clientHasMeeting segue regra V1 (inclui reunião analítica no recorte)", () => {
  const withFutureOnly = {
    clientId: "f1",
    hasValidMeeting: false,
    journeyMeetingsCount: 0,
    meetings: [
      meeting({ meetingId: "fut", meetingDateStatus: "future", startTime: "2026-12-01T12:00:00.000Z" }),
    ],
  };
  assert.equal(clientHasMeeting(withFutureOnly), false);
  const withValid = {
    clientId: "v1",
    hasValidMeeting: true,
    journeyMeetingsCount: 1,
    meetings: [meeting({})],
  };
  assert.equal(clientHasMeeting(withValid), true);
});

test("identidade cobertura e nunca reunidos", () => {
  const rows = [
    { clientId: "1", hasValidMeeting: true, journeyMeetingsCount: 1, meetings: [meeting({})], firstMeetingCompleted: true, absences: 0, reschedules: 0, daysSinceLastMeeting: 10, averageIntervalDays: 20, frequencyBand: "1 reunião" },
    { clientId: "2", hasValidMeeting: false, journeyMeetingsCount: 0, meetings: [], firstMeetingCompleted: false, absences: 0, reschedules: 0, frequencyBand: "Nenhuma" },
  ];
  const summary = summarizeMeetingRows(rows, { now });
  assert.equal(summary.clientsWithMeeting, 1);
  assert.equal(summary.clientsWithoutMeeting, 1);
  assert.equal(summary.meetingCoverageRate, 50);
  assert.equal(summary.clientsWithMeeting + summary.clientsWithoutMeeting, summary.filteredClients);
});

test("intervalo típico usa mediana por cliente", () => {
  const rows = [
    { clientId: "1", meetings: [meeting({})], averageIntervalDays: 10, typicalIntervalDays: 10, absences: 0, reschedules: 0, hasValidMeeting: true, firstMeetingCompleted: true, daysSinceLastMeeting: 5, frequencyBand: "1 reunião" },
    { clientId: "2", meetings: [meeting({ meetingId: "m2" })], averageIntervalDays: 50, typicalIntervalDays: 50, absences: 0, reschedules: 0, hasValidMeeting: true, firstMeetingCompleted: true, daysSinceLastMeeting: 5, frequencyBand: "1 reunião" },
  ];
  const summary = summarizeMeetingRows(rows, { now });
  assert.equal(summary.averageIntervalDays, 30);
  assert.equal(summary.typicalIntervalDays, 30);
});

test("recência típica usa mediana e texto auxiliar não hardcodado", () => {
  assert.equal(recencySecondaryNote(null, null, () => "x"), "Sem reunião registrada");
  assert.equal(recencySecondaryNote("2026-08-19T17:30:00.000Z", 0, () => "19/08/2026"), "Última reunião registrada hoje");
  assert.equal(
    recencySecondaryNote("2026-08-10T12:00:00.000Z", 9, (iso) => iso.slice(0, 10)),
    "Última reunião registrada em 2026-08-10",
  );
});

test("payload público reduz campos e preserva indicadores", () => {
  const full = buildMeetingsPayload({
    now,
    clients: [
      { id: "1", name: "Ana", status: "Ativo", engenheiro_patrimonial: "EP1", data_inicio_ciclo: "2024-01-10", created_at: "2024-01-01" },
      { id: "2", name: "Bruno", status: "Cancelado", engenheiro_patrimonial: "EP2", data_inicio_ciclo: "2024-01-10", created_at: "2024-01-01" },
    ],
    calendlyRows: [
      { id: "ok", client_id: "1", event_name: "Checkpoint Pharus", start_time: "2024-02-01T12:00:00.000Z", calendly_event_uri: "uri-ok" },
    ],
    manualRows: [],
    attendanceRows: [{ calendly_event_uri: "uri-ok", status: "compareceu" }],
    implRows: [],
    cancellations: [],
    meetingTypes: {
      available: true,
      byFamily: [{ label: "Checkpoint", count: 2, percent: 100, canceled: 0 }],
      byRaw: [{ label: "Checkpoint Pharus", count: 2, percent: 100 }],
      events: [
        {
          eventUuid: "abc",
          rawEventType: "Checkpoint Pharus",
          title: "Checkpoint Pharus",
          canceled: false,
          startTime: "2024-02-01T12:00:00.000Z",
          groupName: "CS",
          meetingFamily: "Checkpoint",
          productContext: "Pharus",
        },
      ],
    },
  });
  const pub = toPublicMeetingsPayload(full);
  const json = JSON.stringify(pub);
  assert.equal(pub.summary, undefined);
  assert.equal(pub.quality, undefined);
  assert.equal(pub.distributions, undefined);
  assert.equal(json.includes("eventUuid"), false);
  assert.equal(json.includes("hostEmail"), false);
  assert.equal(json.includes("recordingUrl"), false);
  assert.equal(json.includes("dataWarnings"), false);
  assert.equal(pub.clients[0].meetings[0].title, undefined);
  assert.equal(pub.clients[0].meetings[0].meetingId, "ok");
  assert.equal(pub.clients[0].meetings[0].startTime, "2024-02-01T12:00:00.000Z");
  assert.equal(pub.meetingTypes.events[0].rawEventType, "Checkpoint Pharus");

  const activeFull = applyMeetingFilters(full.clients, defaultMeetingFilters(), { now });
  const activePub = applyMeetingFilters(pub.clients, defaultMeetingFilters(), { now });
  const fullSummary = summarizeMeetingRows(activeFull, { now });
  const pubSummary = summarizeMeetingRows(activePub, { now });
  assert.equal(pubSummary.filteredClients, fullSummary.filteredClients);
  assert.equal(pubSummary.totalMeetings, fullSummary.totalMeetings);
  assert.equal(pubSummary.clientsWithMeeting, fullSummary.clientsWithMeeting);
  assert.equal(pubSummary.clientsWithoutMeeting, fullSummary.clientsWithoutMeeting);
  assert.equal(pubSummary.meetingCoverageRate, fullSummary.meetingCoverageRate);
  assert.equal(pubSummary.attendanceRate, fullSummary.attendanceRate);
  assert.equal(pubSummary.noShowRate, fullSummary.noShowRate);
  assert.equal(pubSummary.firstMeetingCompletionRate, fullSummary.firstMeetingCompletionRate);
  assert.equal(pubSummary.typicalDaysSinceLastMeeting, fullSummary.typicalDaysSinceLastMeeting);

  const detail = toPublicClientDetail(full.clients[0]);
  assert.equal(detail.meetings[0].title, "Checkpoint Pharus");
  assert.equal(detail.meetings[0].source, "calendly");
});
