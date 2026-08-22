import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareMeetingRecordSets,
  meetingDedupeKey,
} from "../../lib/analytics/meetings-fidelity.mjs";
import {
  countTotalMeetingsForClient,
  isValidTotalMeetingStart,
} from "../../lib/analytics/meeting-total-count.mjs";
import { isAnalyticMeeting, isConfirmedNoShow, summarizeMeetingRows } from "../../lib/analytics/meeting-metrics.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");
const entryDate = new Date("2025-01-01T00:00:00.000Z");

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

function clientRow(partial) {
  return {
    clientId: "1",
    hasValidMeeting: true,
    firstMeetingCompleted: true,
    absences: 1,
    reschedules: 0,
    ...partial,
  };
}

test("dedupe key estável para reunião duplicada", () => {
  const a = meeting({ meetingId: "42" });
  const b = meeting({ meetingId: "42", title: "Outro" });
  assert.equal(meetingDedupeKey(a), meetingDedupeKey(b));
});

test("fixture V1: futura, cancelada, pré-entrada, manual, no-show, sem attendance", () => {
  const rows = [
    clientRow({
      /** summarizeMeetingRows soma client.totalMeetings — KPI oficial por cliente, não length(meetings). */
      totalMeetings: 7,
      meetings: [
        meeting({ meetingId: "ok" }),
        meeting({ meetingId: "future", startTime: "2026-12-01T12:00:00.000Z", meetingDateStatus: "future" }),
        meeting({ meetingId: "cancel", attendanceStatus: "cancelada" }),
        meeting({ meetingId: "pre", meetingDateStatus: "before_client_entry", startTime: "2024-01-01T12:00:00.000Z" }),
        meeting({ meetingId: "noshow", attendanceStatus: "nao_compareceu" }),
        meeting({ meetingId: "unk", attendanceStatus: "desconhecido" }),
        meeting({ meetingId: "dup", title: "Checkpoint" }),
        meeting({ meetingId: "manual", source: "manual", meetingId: "manual:9" }),
      ],
    }),
  ];
  const summary = summarizeMeetingRows(rows, { now });
  assert.equal(summary.totalMeetings, 7);
  assert.equal(summary.futureMeetings, 1);
  assert.equal(summary.cancelledMeetings, 1);
  assert.equal(summary.noShowsEligible, 1);
  assert.equal(isConfirmedNoShow(meeting({ attendanceStatus: "nao_compareceu" }), now), true);
  assert.equal(isAnalyticMeeting(meeting({ meetingDateStatus: "before_client_entry" })), false);
});

test("regra oficial total: 5 client_meetings + 1 manual duplicada + 2 manual exclusivas = 7", () => {
  const calendlyRows = [
    { id: "cm1", client_id: "c1", start_time: "2025-06-01T12:00:00.000Z" },
    { id: "cm2", client_id: "c1", start_time: "2025-07-01T12:00:00.000Z" },
    { id: "cm3", client_id: "c1", start_time: "2025-08-01T12:00:00.000Z" },
    { id: "cm4", client_id: "c1", start_time: "2025-09-01T12:00:00.000Z" },
    { id: "cm5", client_id: "c1", start_time: "2025-10-01T12:00:00.000Z" },
  ];
  const manualRows = [
    { id: "m1", client_id: "c1", start_time: "2025-06-01T12:00:00.000Z" },
    { id: "m2", client_id: "c1", start_time: "2025-11-01T12:00:00.000Z" },
    { id: "m3", client_id: "c1", start_time: "2025-12-01T12:00:00.000Z" },
  ];
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows,
    manualRows,
    entryDate,
    now,
  });
  assert.equal(result.clientMeetingsValid, 5);
  assert.equal(result.manualDuplicates, 1);
  assert.equal(result.manualExclusive, 2);
  assert.equal(result.total, 7);
});

test("regra oficial total: exclusões pré-entrada, start inválido e cliente fora do recorte", () => {
  const calendlyRows = [
    { id: "cm1", client_id: "c1", start_time: "2024-06-01T12:00:00.000Z" },
    { id: "cm2", client_id: "c1", start_time: "2025-06-01T12:00:00.000Z" },
    { id: "cm3", client_id: "c2", start_time: "2025-07-01T12:00:00.000Z" },
    { id: "cm4", client_id: "c1", start_time: null },
  ];
  const manualRows = [
    { id: "m1", client_id: "c1", start_time: "2024-12-01T12:00:00.000Z" },
    { id: "m2", client_id: "c1", start_time: "2025-08-01T12:00:00.000Z" },
  ];
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows,
    manualRows,
    entryDate,
    now,
  });
  assert.equal(result.clientMeetingsValid, 1);
  assert.equal(result.manualExclusive, 1);
  assert.equal(result.total, 2);
  assert.equal(isValidTotalMeetingStart(new Date("2024-06-01T12:00:00.000Z"), entryDate, now), false);
});

test("compareMeetingRecordSets detecta only_v1 / only_v2", () => {
  const v1 = [{ clientId: "1", meetings: [meeting({ meetingId: "a" })] }];
  const v2 = [{ clientId: "1", meetings: [meeting({ meetingId: "b" })] }];
  const diff = compareMeetingRecordSets(v1, v2);
  assert.equal(diff.onlyV1, 1);
  assert.equal(diff.onlyV2, 1);
  assert.equal(diff.intersection, 0);
});
