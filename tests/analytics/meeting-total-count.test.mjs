import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countTotalMeetingsForClient,
  meetingStartCorrespondenceKey,
} from "../../lib/analytics/meeting-total-count.mjs";
import { parseDate } from "../../lib/analytics/meeting-metrics.mjs";

const entry = parseDate("2024-01-01T00:00:00.000Z");
const now = parseDate("2026-01-01T00:00:00.000Z");

test("correspondência usa client_id + start_time ISO", () => {
  const key = meetingStartCorrespondenceKey("c1", "2024-06-01T15:00:00.000Z");
  assert.match(key, /^c1\|/);
});

test("manual equivalente não soma no total", () => {
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows: [{ client_id: "c1", start_time: "2024-06-01T15:00:00.000Z", id: 1 }],
    manualRows: [{ client_id: "c1", start_time: "2024-06-01T15:00:00.000Z", id: 2 }],
    entryDate: entry,
    now,
  });
  assert.equal(result.clientMeetingsValid, 1);
  assert.equal(result.manualExclusive, 0);
  assert.equal(result.manualDuplicates, 1);
  assert.equal(result.total, 1);
});

test("manual exclusiva soma no total", () => {
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows: [{ client_id: "c1", start_time: "2024-06-01T15:00:00.000Z", id: 1 }],
    manualRows: [{ client_id: "c1", start_time: "2024-06-02T15:00:00.000Z", id: 2 }],
    entryDate: entry,
    now,
  });
  assert.equal(result.total, 2);
  assert.equal(result.manualExclusive, 1);
});

test("reunião anterior à entrada exclui", () => {
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows: [{ client_id: "c1", start_time: "2023-12-01T15:00:00.000Z", id: 1 }],
    manualRows: [],
    entryDate: entry,
    now,
  });
  assert.equal(result.total, 0);
});

test("duas client_meetings mesmo horário não deduplica", () => {
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows: [
      { client_id: "c1", start_time: "2024-06-01T15:00:00.000Z", id: 1 },
      { client_id: "c1", start_time: "2024-06-01T15:00:00.000Z", id: 2 },
    ],
    manualRows: [],
    entryDate: entry,
    now,
  });
  assert.equal(result.clientMeetingsValid, 2);
  assert.equal(result.total, 2);
});

test("cliente fora do recorte não entra na contagem por cliente", () => {
  const result = countTotalMeetingsForClient({
    clientId: "c1",
    calendlyRows: [{ client_id: "c2", start_time: "2024-06-01T15:00:00.000Z", id: 1 }],
    manualRows: [],
    entryDate: entry,
    now,
  });
  assert.equal(result.total, 0);
});
