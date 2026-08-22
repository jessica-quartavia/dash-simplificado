import test from "node:test";
import assert from "node:assert/strict";
import {
  clientToSnapshotRow,
  compareClientFeatureRecords,
  compareLiveAndSnapshotClients,
  isSnapshotFresh,
  roundTripSnapshotClients,
  STATISTICAL_SNAPSHOT_TTL_MS,
} from "../../lib/analytics/statistical-snapshot.mjs";
import {
  STATISTICAL_SNAPSHOT_CLIENT_FIELDS,
  STATISTICAL_SNAPSHOT_PII_FIELDS,
} from "../../lib/analytics/statistical-feature-registry.mjs";

function mockClient(overrides = {}) {
  const base = {
    clientId: "c-100",
    clientCode: "QV100",
    clientName: "Cliente Teste",
    analyticalStatus: "active",
    program: "premium",
    engineer: "EP A",
    segment: "A",
    hireDate: "2024-01-15T00:00:00.000Z",
    cancellationDate: null,
    isActive: true,
    isCancelled: false,
    isFrozen: false,
    stayDays: 400,
    stayBand: "12m+",
    meetingCount: 12,
    meetingsPerMonth: 0.9,
    noShowCount: 1,
    rescheduleCount: 0,
    attendanceRate: 0.92,
    daysSinceLastMeeting: 14,
    averageIntervalDays: 30,
    daysToFirstMeeting: 7,
    hasMeeting: true,
    firstMeetingCompleted: true,
    mechanismCount: 3,
    implementedMechanismCount: 2,
    implementationPercent: 66.7,
    implementationRate: 0.667,
    hasMechanism: true,
    hasFirstImplementation: true,
    monthlyIncome: 25000,
    liquidityReserve: 50000,
    lastContribution: 3000,
    paidPropertiesValue: 800000,
    hasFinancialData: true,
    incomeBand: "20k-30k",
    liquidityBand: "40k-60k",
    financialUpdateCount: 4,
    daysSinceFinancialUpdate: 30,
    currentCycle: 2,
    renewalCount: 1,
    hasRenewed: true,
    renewedValid: true,
    npsScore: 9,
    npsClass: "promoter",
    hasNps: true,
    npsPredictiveOk: true,
    survivalTime: 400,
    survivalEvent: 0,
    survivalValid: true,
  };
  return { ...base, ...overrides };
}

test("STATISTICAL_FEATURE_REGISTRY cobre todos os client fields", () => {
  assert.ok(STATISTICAL_SNAPSHOT_CLIENT_FIELDS.length >= 40);
  assert.deepEqual(STATISTICAL_SNAPSHOT_PII_FIELDS, ["clientName"]);
});

test("round-trip snapshot preserva features por cliente", () => {
  const clients = [mockClient(), mockClient({ clientId: "c-200", clientName: "Outro" })];
  const version = "test-v1";
  const generatedAt = "2026-08-22T12:00:00.000Z";
  const roundTrip = roundTripSnapshotClients(clients, version, generatedAt);
  const report = compareLiveAndSnapshotClients(clients, roundTrip);
  assert.equal(report.pass, true, JSON.stringify(report.mismatches.slice(0, 1)));
});

test("clientToSnapshotRow denormaliza colunas de filtro", () => {
  const row = clientToSnapshotRow(mockClient(), "v1", "2026-08-22T12:00:00.000Z");
  assert.equal(row.client_id, "c-100");
  assert.equal(row.client_code, "QV100");
  assert.equal(row.engineer, "EP A");
  assert.ok(row.features && typeof row.features === "object");
  for (const field of STATISTICAL_SNAPSHOT_CLIENT_FIELDS) {
    assert.ok(Object.hasOwn(row.features, field), `missing feature ${field}`);
  }
});

test("compareClientFeatureRecords tolera floats", () => {
  const live = mockClient({ meetingsPerMonth: 0.9000000001 });
  const snap = mockClient({ meetingsPerMonth: 0.9 });
  const diffs = compareClientFeatureRecords(live, snap);
  assert.equal(diffs.length, 0);
});

test("isSnapshotFresh respeita TTL de 15 min", () => {
  const now = Date.now();
  assert.equal(isSnapshotFresh({ generated_at: new Date(now - 5 * 60 * 1000).toISOString() }, STATISTICAL_SNAPSHOT_TTL_MS, now), true);
  assert.equal(isSnapshotFresh({ snapshot_generated_at: new Date(now - 20 * 60 * 1000).toISOString() }, STATISTICAL_SNAPSHOT_TTL_MS, now), false);
});

test("compareLiveAndSnapshotClients detecta divergência", () => {
  const live = [mockClient()];
  const snap = [mockClient({ meetingCount: 99 })];
  const report = compareLiveAndSnapshotClients(live, snap);
  assert.equal(report.pass, false);
  assert.ok(report.mismatches.length > 0);
});
