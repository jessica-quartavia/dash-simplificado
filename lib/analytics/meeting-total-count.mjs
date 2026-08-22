/**
 * KPI "Total de Reuniões" — regra oficial BASE QV.
 *
 * TOTAL = client_meetings válidas + manual_meetings válidas sem correspondência
 * em client_meetings (mesmo client_id + mesmo start_time).
 *
 * Não deduplica dentro de client_meetings. Não usa Calendly/Business Data.
 */
import { blankToNull, classifyMeetingDate, parseDate, startOfUtcDay } from "./meeting-metrics.mjs";

export function meetingStartCorrespondenceKey(clientId, startTime) {
  const id = blankToNull(clientId);
  const start = parseDate(startTime);
  if (!id || !start) return null;
  return `${String(id)}|${start.toISOString()}`;
}

export function isValidTotalMeetingStart(start, entryDate, now = new Date()) {
  if (!start) return false;
  const status = classifyMeetingDate(start, entryDate, now);
  return status !== "before_client_entry" && status !== "invalid";
}

export function meetingStartInPeriod(start, period) {
  if (!period?.active) return true;
  if (!start) return false;
  if (period.from && start < period.from) return false;
  if (period.to && start > period.to) return false;
  return true;
}

function rowClientId(row) {
  return blankToNull(row?.client_id);
}

function rowStart(row) {
  return parseDate(row?.start_time);
}

/**
 * Contagem oficial por cliente a partir das linhas brutas BASE QV.
 */
export function countTotalMeetingsForClient({
  clientId,
  calendlyRows = [],
  manualRows = [],
  entryDate = null,
  period = null,
  now = new Date(),
} = {}) {
  const id = String(clientId || "");
  const validCalendly = [];
  for (const row of calendlyRows) {
    if (String(rowClientId(row) || "") !== id) continue;
    const start = rowStart(row);
    if (!isValidTotalMeetingStart(start, entryDate, now)) continue;
    if (!meetingStartInPeriod(start, period)) continue;
    validCalendly.push(row);
  }

  const correspondenceKeys = new Set(
    validCalendly
      .map((row) => meetingStartCorrespondenceKey(id, row.start_time))
      .filter(Boolean),
  );

  let manualMeetingsValid = 0;
  let manualDuplicates = 0;
  let manualExclusive = 0;
  for (const row of manualRows) {
    if (String(rowClientId(row) || "") !== id) continue;
    const start = rowStart(row);
    if (!isValidTotalMeetingStart(start, entryDate, now)) continue;
    if (!meetingStartInPeriod(start, period)) continue;
    manualMeetingsValid += 1;
    const key = meetingStartCorrespondenceKey(id, row.start_time);
    if (key && correspondenceKeys.has(key)) {
      manualDuplicates += 1;
    } else {
      manualExclusive += 1;
    }
  }

  return {
    clientMeetingsValid: validCalendly.length,
    manualMeetingsValid,
    manualDuplicates,
    manualExclusive,
    total: validCalendly.length + manualExclusive,
  };
}

export function buildTotalCountSourceForClient(calendlyRows = [], manualRows = [], clientId) {
  const id = String(clientId || "");
  return {
    calendlyStarts: calendlyRows
      .filter((row) => String(rowClientId(row) || "") === id && rowStart(row))
      .map((row) => row.start_time),
    manualStarts: manualRows
      .filter((row) => String(rowClientId(row) || "") === id && rowStart(row))
      .map((row) => row.start_time),
  };
}

export function countTotalMeetingsFromSource(source, entryDate, period = null, now = new Date()) {
  const calendlyRows = (source?.calendlyStarts || []).map((start_time) => ({ client_id: "x", start_time }));
  const manualRows = (source?.manualStarts || []).map((start_time) => ({ client_id: "x", start_time }));
  return countTotalMeetingsForClient({
    clientId: "x",
    calendlyRows: calendlyRows.map((row, i) => ({ ...row, client_id: "x" })),
    manualRows: manualRows.map((row) => ({ ...row, client_id: "x" })),
    entryDate,
    period,
    now,
  });
}

export function aggregateTotalMeetingBreakdown(counts = []) {
  return counts.reduce(
    (acc, item) => ({
      clientMeetingsValid: acc.clientMeetingsValid + (item.clientMeetingsValid || 0),
      manualMeetingsValid: acc.manualMeetingsValid + (item.manualMeetingsValid || 0),
      manualDuplicates: acc.manualDuplicates + (item.manualDuplicates || 0),
      manualExclusive: acc.manualExclusive + (item.manualExclusive || 0),
      total: acc.total + (item.total || 0),
    }),
    {
      clientMeetingsValid: 0,
      manualMeetingsValid: 0,
      manualDuplicates: 0,
      manualExclusive: 0,
      total: 0,
    },
  );
}

/** Chave estável para diagnóstico de sets (sem PII). */
export function totalMeetingRecordKey(clientId, startTime, source, rowId = null) {
  const key = meetingStartCorrespondenceKey(clientId, startTime);
  if (!key) return null;
  return `${source || "unknown"}:${rowId || key}`;
}

export function buildExpectedTotalMeetingSet({
  clients = [],
  calendlyRows = [],
  manualRows = [],
  period = null,
  now = new Date(),
  clientFilter = () => true,
} = {}) {
  const keys = new Set();
  const records = [];
  for (const client of clients) {
    if (!clientFilter(client)) continue;
    const clientId = String(client.id || client.clientId || "");
    const entryDate = parseDate(client.data_inicio_ciclo) || parseDate(client.created_at) || parseDate(client.entryDate);
    const breakdown = countTotalMeetingsForClient({
      clientId,
      calendlyRows,
      manualRows,
      entryDate,
      period,
      now,
    });

    for (const row of calendlyRows) {
      if (String(rowClientId(row) || "") !== clientId) continue;
      const start = rowStart(row);
      if (!isValidTotalMeetingStart(start, entryDate, now)) continue;
      if (!meetingStartInPeriod(start, period)) continue;
      const recordKey = totalMeetingRecordKey(clientId, row.start_time, "client_meetings", row.id);
      if (!recordKey || keys.has(recordKey)) continue;
      keys.add(recordKey);
      records.push({ key: recordKey, source: "client_meetings", clientId, startTime: row.start_time });
    }

    const calendlyKeys = new Set(
      calendlyRows
        .filter((row) => String(rowClientId(row) || "") === clientId)
        .map((row) => meetingStartCorrespondenceKey(clientId, row.start_time))
        .filter(Boolean),
    );

    for (const row of manualRows) {
      if (String(rowClientId(row) || "") !== clientId) continue;
      const start = rowStart(row);
      if (!isValidTotalMeetingStart(start, entryDate, now)) continue;
      if (!meetingStartInPeriod(start, period)) continue;
      const corr = meetingStartCorrespondenceKey(clientId, row.start_time);
      if (corr && calendlyKeys.has(corr)) continue;
      const recordKey = totalMeetingRecordKey(clientId, row.start_time, "manual_meetings", row.id);
      if (!recordKey || keys.has(recordKey)) continue;
      keys.add(recordKey);
      records.push({ key: recordKey, source: "manual_exclusive", clientId, startTime: row.start_time });
    }

    void breakdown;
  }
  return { keys, records };
}

export function buildCurrentV2TotalMeetingSet(rows = [], period = null, now = new Date()) {
  const keys = new Set();
  const records = [];
  for (const client of rows) {
    for (const meeting of client.meetings || []) {
      if (meeting.meetingDateStatus === "before_client_entry" || meeting.meetingDateStatus === "invalid") continue;
      const start = parseDate(meeting.startTime);
      if (!start) continue;
      if (period?.active) {
        if (period.from && start < period.from) continue;
        if (period.to && start > period.to) continue;
      }
      const recordKey = totalMeetingRecordKey(
        client.clientId,
        meeting.startTime,
        meeting.source || "unknown",
        meeting.meetingId,
      );
      if (!recordKey || keys.has(recordKey)) continue;
      keys.add(recordKey);
      records.push({
        key: recordKey,
        source: meeting.source || "unknown",
        clientId: client.clientId,
        startTime: meeting.startTime,
        meetingId: meeting.meetingId,
      });
    }
  }
  return { keys, records };
}

export function classifyExtraTotalMeetingRecord(record, { calendlyRows = [], manualRows = [], entryDate = null, now = new Date() } = {}) {
  const clientId = String(record?.clientId || "");
  const start = parseDate(record?.startTime);
  if (!start) return "invalid_date";
  if (entryDate && startOfUtcDay(start) < startOfUtcDay(entryDate)) return "pre_entry";
  const corr = meetingStartCorrespondenceKey(clientId, record.startTime);
  if (record.source === "manual" && corr) {
    const hasCalendly = calendlyRows.some(
      (row) =>
        String(rowClientId(row) || "") === clientId &&
        meetingStartCorrespondenceKey(clientId, row.start_time) === corr,
    );
    if (hasCalendly) return "manual_duplicate_included";
  }
  if (record.source === "manual") {
    const manualRow = manualRows.find(
      (row) =>
        String(rowClientId(row) || "") === clientId &&
        meetingStartCorrespondenceKey(clientId, row.start_time) === corr,
    );
    if (manualRow && corr) {
      const titleMismatch =
        manualRow.title &&
        calendlyRows.some(
          (row) =>
            String(rowClientId(row) || "") === clientId &&
            meetingStartCorrespondenceKey(clientId, row.start_time) === corr,
        );
      if (titleMismatch) return "manual_duplicate_included";
    }
  }
  return "other";
}

export function compareTotalMeetingSets(expectedKeys, currentKeys, currentRecords = [], context = {}) {
  const expected = expectedKeys instanceof Set ? expectedKeys : new Set(expectedKeys || []);
  const current = currentKeys instanceof Set ? currentKeys : new Set(currentKeys || []);
  const onlyExpected = [...expected].filter((k) => !current.has(k));
  const onlyCurrent = [...current].filter((k) => !expected.has(k));
  const intersection = [...expected].filter((k) => current.has(k));
  const causeCounts = {};
  for (const key of onlyCurrent) {
    const record = currentRecords.find((r) => r.key === key);
    const cause = classifyExtraTotalMeetingRecord(record, context);
    causeCounts[cause] = (causeCounts[cause] || 0) + 1;
  }
  return {
    expectedCount: expected.size,
    currentCount: current.size,
    intersection: intersection.length,
    onlyExpected: onlyExpected.length,
    onlyCurrent: onlyCurrent.length,
    onlyCurrentByCause: causeCounts,
  };
}
