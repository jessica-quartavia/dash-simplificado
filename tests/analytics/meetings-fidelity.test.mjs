import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareMeetingRecordSets,
  meetingDedupeKey,
} from "../../lib/analytics/meetings-fidelity.mjs";
import { isAnalyticMeeting, isConfirmedNoShow, summarizeMeetingRows } from "../../lib/analytics/meeting-metrics.mjs";

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

test("dedupe key estável para reunião duplicada", () => {
  const a = meeting({ meetingId: "42" });
  const b = meeting({ meetingId: "42", title: "Outro" });
  assert.equal(meetingDedupeKey(a), meetingDedupeKey(b));
});

test("fixture V1: futura, cancelada, pré-entrada, manual, no-show, sem attendance", () => {
  const rows = [
    {
      clientId: "1",
      hasValidMeeting: true,
      firstMeetingCompleted: true,
      absences: 1,
      reschedules: 0,
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
    },
  ];
  const summary = summarizeMeetingRows(rows, { now });
  assert.equal(summary.totalMeetings, 7);
  assert.equal(summary.futureMeetings, 1);
  assert.equal(summary.cancelledMeetings, 1);
  assert.equal(summary.noShowsEligible, 1);
  assert.equal(isConfirmedNoShow(meeting({ attendanceStatus: "nao_compareceu" }), now), true);
  assert.equal(isAnalyticMeeting(meeting({ meetingDateStatus: "before_client_entry" })), false);
});

test("compareMeetingRecordSets detecta only_v1 / only_v2", () => {
  const v1 = [{ clientId: "1", meetings: [meeting({ meetingId: "a" })] }];
  const v2 = [{ clientId: "1", meetings: [meeting({ meetingId: "b" })] }];
  const diff = compareMeetingRecordSets(v1, v2);
  assert.equal(diff.onlyV1, 1);
  assert.equal(diff.onlyV2, 1);
  assert.equal(diff.intersection, 0);
});
