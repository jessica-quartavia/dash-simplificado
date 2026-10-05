import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPageById } from "../../js/pages.js";
import {
  canAccessPage,
  getPageAccessMetadata,
  PAGE_ACCESS_REGISTRY,
} from "../../lib/access/access-policy.mjs";
import {
  buildInternalJourneyBottlenecksPayload,
  classifyAttentionLevel,
  countDaysWithoutMeetingAtLeast,
  IJB_EP_MIN_N,
} from "../../lib/analytics/internal-journey-bottlenecks.mjs";
import { filterJourneyBottleneckRows, defaultInternalJourneyBottlenecksFilters } from "../../lib/analytics/internal-journey-bottlenecks-filters.mjs";
import { sortUnknownLast } from "../../lib/analytics/filters/sort-categories.mjs";
import { getPageFilterContract } from "../../lib/analytics/filters/page-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function mockRow(overrides = {}) {
  return {
    clientId: "1",
    clientCode: "C1",
    clientName: "Cliente Teste",
    engineer: "EP A",
    program: "Pharus",
    segment: "Core",
    analyticalStatus: "Ativo",
    contractDate: "2025-01-01T00:00:00.000Z",
    completedOnboarding: false,
    daysToFirstMeeting: 20,
    daysToPlanDelivery: null,
    daysToFirstImplementation: null,
    totalOnboardingDays: 20,
    inComparableCohort: true,
    firstMeetingCompleted: false,
    hasValidMeeting: false,
    totalMeetings: 0,
    daysSinceLastMeeting: null,
    journeyStarted: true,
    hasPlan: false,
    hasMechanism: false,
    tenureDays: 100,
    ...overrides,
  };
}

test("página registrada antes de Relatórios", () => {
  const imr = getPageById("internal_mechanisms_renewal_projection");
  const ijb = getPageById("internal_journey_bottlenecks");
  const reports = getPageById("reports");
  assert.ok(ijb);
  assert.equal(ijb.hash, "internal-journey-bottlenecks");
  assert.ok(ijb.navLabel.includes("Gargalos"));
  const internal = ["internal_mechanisms_satisfaction", "internal_mechanisms_renewal_projection", "internal_journey_bottlenecks", "reports"];
  for (const id of internal) assert.ok(getPageById(id));
  assert.ok(internal.indexOf(ijb.id) < internal.indexOf(reports.id));
});

test("permissões Owner e Produto", () => {
  assert.ok(PAGE_ACCESS_REGISTRY.internal_journey_bottlenecks.includes("product"));
  assert.equal(canAccessPage({ isOwner: true, isActive: true, groups: [] }, "internal_journey_bottlenecks"), true);
  assert.equal(canAccessPage({ isActive: true, groups: ["product"] }, "internal_journey_bottlenecks"), true);
  assert.equal(canAccessPage({ isActive: true, groups: ["leaders"] }, "internal_journey_bottlenecks"), false);
  assert.equal(canAccessPage({ isActive: true, groups: ["eps"] }, "internal_journey_bottlenecks"), false);
  assert.equal(canAccessPage({ isActive: true, groups: [] }, "internal_journey_bottlenecks"), false);
  const meta = getPageAccessMetadata("internal_journey_bottlenecks");
  assert.equal(meta.preload, false);
  assert.equal(meta.ownerOnly, false);
});

test("recência 30+/60+/90+ count alinhado ao percentual", () => {
  const rows = [
    mockRow({ clientId: "1", firstMeetingCompleted: false, tenureDays: 45, daysSinceLastMeeting: null }),
    mockRow({ clientId: "2", daysSinceLastMeeting: 35, firstMeetingCompleted: true }),
    mockRow({ clientId: "3", daysSinceLastMeeting: 5, firstMeetingCompleted: true }),
  ];
  const c30 = countDaysWithoutMeetingAtLeast(rows, 30);
  assert.equal(c30, 2);
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  const rec = payload.meetings.recency;
  assert.equal(rec.count30Plus, c30);
  assert.equal(rec.pct30Plus, Math.round((c30 / 3) * 1000) / 10);
  assert.equal(payload.epTable[0].withoutMeetingCount, payload.epTable[0].withoutMeeting);
});

test("EP: sem reunião % e 60+ d são métricas distintas", () => {
  const rows = [
    mockRow({ clientId: "1", engineer: "EP Beta", firstMeetingCompleted: false, tenureDays: 70 }),
    mockRow({ clientId: "2", engineer: "EP Beta", firstMeetingCompleted: true, daysSinceLastMeeting: 65 }),
    mockRow({ clientId: "3", engineer: "EP Beta", firstMeetingCompleted: true, daysSinceLastMeeting: 5 }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  const ep = payload.epTable.find((r) => r.ep === "EP Beta");
  assert.equal(ep.withoutMeetingPct, Math.round((1 / 3) * 1000) / 10);
  assert.notEqual(ep.withoutMeetingPct, ep.days60WithoutMeetingPct);
});

test("EP sem reunião: count e pct consistentes (10 clientes, 4 sem reunião)", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    mockRow({
      clientId: String(i),
      engineer: "EP Alpha",
      firstMeetingCompleted: i < 4 ? false : true,
      daysToFirstMeeting: i < 4 ? null : 5,
    }),
  );
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  const ep = payload.epTable.find((r) => r.ep === "EP Alpha");
  assert.equal(ep.clients, 10);
  assert.equal(ep.withoutMeetingCount, 4);
  assert.equal(ep.withoutMeetingPct, 40);
});

test("resolveAttentionClientsAll: array vazio não bloqueia alias", async () => {
  const { resolveAttentionClientsAll, expectedAttentionClientsTotal } = await import(
    "../../lib/analytics/internal-journey-bottlenecks-attention.mjs"
  );
  const rows = [{ clientId: "1", clientName: "A" }];
  assert.equal(resolveAttentionClientsAll({ attentionClientsAll: [], attentionClientRows: rows }).length, 1);
  assert.equal(resolveAttentionClientsAll({ attentionClients: { rows } }).length, 1);
  assert.equal(
    expectedAttentionClientsTotal({ attentionClientsAll: [], summary: { stalledJourney: 1332 } }),
    1332,
  );
});

test("atenção fixture mínima (3 entram, 1 fica de fora)", () => {
  const rows = [
    mockRow({ clientId: "A", completedOnboarding: false, firstMeetingCompleted: true, daysSinceLastMeeting: 5 }),
    mockRow({ clientId: "B", firstMeetingCompleted: false, totalMeetings: 0, hasValidMeeting: false }),
    mockRow({
      clientId: "C",
      firstMeetingCompleted: true,
      daysSinceLastMeeting: 95,
      completedOnboarding: true,
      daysToFirstMeeting: 10,
    }),
    mockRow({
      clientId: "D",
      completedOnboarding: true,
      firstMeetingCompleted: true,
      daysSinceLastMeeting: 5,
      daysToFirstMeeting: 5,
      totalOnboardingDays: 10,
    }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  assert.equal(payload.attentionClientsAll.length, 3);
  assert.equal(payload.attentionClientsTotal, 3);
  assert.equal(payload.summary.stalledJourney, 3);
  assert.ok(payload.attentionClientsAll.some((r) => r.clientId === "A"));
  assert.ok(payload.attentionClientsAll.some((r) => r.clientId === "B"));
  assert.ok(payload.attentionClientsAll.some((r) => r.clientId === "C"));
  assert.ok(!payload.attentionClientsAll.some((r) => r.clientId === "D"));
});

test("atenção inclui cliente sem EP (Não informado)", () => {
  const rows = [
    mockRow({ clientId: "1", engineer: "Não informado", completedOnboarding: false, firstMeetingCompleted: false }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  assert.ok(payload.attentionClientsAll.length >= 1);
  assert.equal(payload.attentionClientsAll[0].engineer, "Não informado");
});

test("EP sem reunião: pct sem count quebrado", async () => {
  const {
    resolveEpWithoutMeetingFields,
    epWithoutMeetingAlert,
    formatEpWithoutMeetingCellTooltip,
  } = await import("../../lib/analytics/internal-journey-bottlenecks-ep-fields.mjs");
  const row = { withoutMeetingPct: 20.5, withoutMeetingCount: 0, clients: 101, smallSample: false };
  const resolved = resolveEpWithoutMeetingFields(row);
  assert.equal(resolved.pct, 20.5);
  assert.equal(resolved.count, null);
  assert.equal(epWithoutMeetingAlert(row, resolved.pct), false);
  const alertRow = { withoutMeetingPct: 42.6, smallSample: false };
  assert.equal(epWithoutMeetingAlert(alertRow, 42.6), true);
  const tipNoCount = formatEpWithoutMeetingCellTooltip(
    { withoutMeetingPct: 20.8, withoutMeetingCount: 0 },
    (n) => String(n),
    (v) => `${v}%`,
  );
  assert.match(tipNoCount, /20\.8%/);
  assert.doesNotMatch(tipNoCount, /0 clientes/);
  const tipWithCount = formatEpWithoutMeetingCellTooltip(
    { withoutMeetingPct: 20.8, withoutMeetingCount: 21, smallSample: false },
    (n) => String(n),
    (v) => `${v}%`,
  );
  assert.match(tipWithCount, /21 clientes sem reunião/);
  assert.match(tipWithCount, /20\.8%/);
});

test("toPublic preserva pct EP quando count ausente", async () => {
  const { toPublicInternalJourneyBottlenecksPayload } = await import("../../lib/analytics/internal-journey-bottlenecks.mjs");
  const out = toPublicInternalJourneyBottlenecksPayload({
    epTable: [{ ep: "EP X", clients: 50, withoutMeetingPct: 20.5 }],
  });
  assert.equal(out.epTable[0].withoutMeetingPct, 20.5);
  assert.equal(out.epTable[0].semReuniaoPct, 20.5);
});

test("toPublic resolve attentionClientsAll com fallback", async () => {
  const { toPublicInternalJourneyBottlenecksPayload } = await import("../../lib/analytics/internal-journey-bottlenecks.mjs");
  const row = { clientId: "9", clientName: "Z" };
  const out = toPublicInternalJourneyBottlenecksPayload({
    attentionClientsAll: [],
    attentionClientRows: [row],
    summary: { stalledJourney: 1 },
  });
  assert.equal(out.attentionClientsAll.length, 1);
  assert.equal(out.attentionClientsAll[0].clientId, "9");
});

test("toPublic normaliza withoutMeetingCount", async () => {
  const { toPublicInternalJourneyBottlenecksPayload } = await import("../../lib/analytics/internal-journey-bottlenecks.mjs");
  const out = toPublicInternalJourneyBottlenecksPayload({
    epTable: [{ ep: "X", clients: 5, withoutMeetingPct: 20, withoutMeeting: 1 }],
    attentionClientsAll: [{ clientId: "1" }],
  });
  assert.equal(out.epTable[0].withoutMeetingCount, 1);
  assert.equal(out.attentionClientsAll.length, 1);
});

test("toPublic normaliza counts de reuniões (recency alias + primeira reunião)", async () => {
  const { toPublicInternalJourneyBottlenecksPayload } = await import("../../lib/analytics/internal-journey-bottlenecks.mjs");
  const out = toPublicInternalJourneyBottlenecksPayload({
    meetings: {
      count30PlusWithoutMeeting: 12,
      pct30PlusWithoutMeeting: 24,
      recency: { pct30Plus: 24, pct60Plus: 10, pct90Plus: 5 },
      firstMeeting: { observableCount: 20, countWithin7: 5, pctWithin7: 25, countWithin14: 8, pctWithin14: 40 },
    },
  });
  assert.equal(out.meetings.recency.count30Plus, 12);
  assert.equal(out.meetings.recency.pct30Plus, 24);
  assert.equal(out.meetings.firstMeeting.countWithin7, 5);
  assert.equal(out.meetings.firstMeeting.pctWithin7, 25);
});

test("cards percentual principal (reuniões e cadência)", async () => {
  const { formatPctPtBr, buildKpiPctPrimaryCard } = await import(
    "../../lib/analytics/internal-journey-bottlenecks-kpi-display.mjs"
  );
  assert.equal(formatPctPtBr(39), "39%");
  assert.equal(formatPctPtBr(21.3), "21,3%");
  assert.equal(formatPctPtBr(13.6), "13,6%");
  const card = buildKpiPctPrimaryCard({ pctVal: 25.4, suffix: "dos clientes observáveis" });
  assert.equal(card.main, "25,4%");
  assert.doesNotMatch(card.htmlSnippet, /—/);
  assert.match(card.htmlSnippet, /dos clientes observáveis/);
  const js = readFileSync(resolve(root, "js/internal-journey-bottlenecks.js"), "utf8");
  const cadence = js.match(/function renderMeetingsCadence[\s\S]*?^function /m)?.[0] ?? "";
  assert.match(cadence, /kpiPctPrimary\("30\+ dias sem reunião"/);
  assert.match(cadence, /kpiPctPrimary\("Até 7 dias"/);
  assert.doesNotMatch(cadence, /kpiCountPct\("30\+ dias sem reunião"/);
  assert.doesNotMatch(cadence, /kpiCountPct\("Até 7 dias"/);
  assert.match(cadence, /kpi\("Mediana"/);
});

test("primeira reunião: count + pct e faixas acumuladas", () => {
  const rows = [
    mockRow({ clientId: "a", daysToFirstMeeting: 3, firstMeetingCompleted: true }),
    mockRow({ clientId: "b", daysToFirstMeeting: 10, firstMeetingCompleted: true }),
    mockRow({ clientId: "c", daysToFirstMeeting: 25, firstMeetingCompleted: true }),
    mockRow({ clientId: "d", daysToFirstMeeting: 40, firstMeetingCompleted: true }),
    mockRow({ clientId: "e", firstMeetingCompleted: false, daysToFirstMeeting: null }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  const fm = payload.meetings.firstMeeting;
  assert.equal(fm.observableCount, 4);
  assert.equal(fm.countWithin7, 1);
  assert.equal(fm.countWithin14, 2);
  assert.equal(fm.countWithin30, 3);
  assert.equal(fm.countOver30, 1);
  assert.equal(fm.pctWithin7, Math.round((1 / 4) * 1000) / 10);
  assert.equal(fm.pctWithin14, Math.round((2 / 4) * 1000) / 10);
  assert.equal(fm.pctWithin30, Math.round((3 / 4) * 1000) / 10);
  assert.equal(fm.pctOver30, Math.round((1 / 4) * 1000) / 10);
  assert.ok(fm.countWithin7 <= fm.countWithin14);
  assert.ok(fm.countWithin14 <= fm.countWithin30);
  if (fm.pctWithin7 > 0) assert.ok(fm.countWithin7 > 0);
});

test("recência 60+/90+ count > 0 quando pct > 0", () => {
  const rows = [
    mockRow({ clientId: "1", firstMeetingCompleted: false, tenureDays: 95, daysSinceLastMeeting: null }),
    mockRow({ clientId: "2", daysSinceLastMeeting: 65, firstMeetingCompleted: true }),
    mockRow({ clientId: "3", daysSinceLastMeeting: 5, firstMeetingCompleted: true }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  const rec = payload.meetings.recency;
  for (const band of [30, 60, 90]) {
    const count = rec[`count${band}Plus`];
    const pctVal = rec[`pct${band}Plus`];
    if (pctVal > 0) assert.ok(count > 0, `${band}+ count deve ser > 0 quando pct > 0`);
    assert.equal(pctVal, Math.round((count / 3) * 1000) / 10);
  }
});

test("default status ativos", () => {
  const f = defaultInternalJourneyBottlenecksFilters();
  assert.equal(f.status, "active");
  const rows = [mockRow({ analyticalStatus: "Ativo" }), mockRow({ clientId: "2", analyticalStatus: "Cancelado" })];
  const filtered = filterJourneyBottleneckRows(rows, f);
  assert.equal(filtered.length, 1);
});

test("payload compute com linhas mock", () => {
  const rows = [
    mockRow(),
    mockRow({ clientId: "2", completedOnboarding: true, firstMeetingCompleted: true, daysToFirstMeeting: 5, hasPlan: true, daysToPlanDelivery: 10 }),
  ];
  const payload = buildInternalJourneyBottlenecksPayload({
    unifiedRows: rows,
    filters: defaultInternalJourneyBottlenecksFilters(),
    meetingTypes: null,
    metadata: {},
  });
  assert.ok(payload.summary.activeClients >= 1);
  assert.ok(payload.funnel.steps.length >= 4);
  assert.ok(Array.isArray(payload.insights));
  assert.ok(payload.meetingsByTypeMeta.source === "Calendly");
  assert.equal(payload.defaultStatusFilter, "active");
  assert.ok(Array.isArray(payload.filterOptions?.engineers));
  assert.ok(Array.isArray(payload.rankings));
  assert.equal(payload.firstMeetingOnboardingHeatmap, undefined);
  assert.equal(payload.firstMeetingHeatmapInsights, undefined);
  assert.equal(payload.cancellationCompare, undefined);
  assert.equal(payload.quality, undefined);
  assert.equal(payload.programTable, undefined);
  assert.equal(payload.onboardingCompleteDistribution, undefined);
  assert.ok(Array.isArray(payload.attentionClientsAll));
  assert.equal(payload.meetings.recency.count30Plus, payload.meetings.recency.pct30Plus > 0 ? payload.meetings.recency.count30Plus : 0);
  if (payload.meetings.recency.pct30Plus > 0) {
    assert.ok(payload.meetings.recency.count30Plus > 0);
  }
});

test("contrato de filtros da página", () => {
  const contract = getPageFilterContract("internal_journey_bottlenecks");
  assert.ok(contract);
  assert.ok(contract.uiFilters.includes("engineer"));
  assert.ok(contract.uiFilters.includes("firstMeeting"));
});

test("classificação jornada parada documentada", () => {
  const { level, reasons } = classifyAttentionLevel(mockRow(), { p75FirstMeetingDays: 10, p75OnboardingDays: 30 });
  assert.ok(["Normal", "Atenção", "Crítico"].includes(level));
  assert.ok(reasons.includes("Sem reunião"));
});

test("EP amostra pequena", () => {
  assert.equal(IJB_EP_MIN_N, 30);
  const rows = Array.from({ length: 5 }, (_, i) => mockRow({ clientId: String(i), engineer: "EP Pequeno" }));
  const payload = buildInternalJourneyBottlenecksPayload({ unifiedRows: rows, filters: defaultInternalJourneyBottlenecksFilters(), meetingTypes: null, metadata: {} });
  assert.equal(payload.epTable[0].smallSample, true);
});

test("Não informado por último", () => {
  const sorted = sortUnknownLast(
    [{ ep: "Não informado" }, { ep: "Alpha" }, { ep: "Beta" }],
    (r) => r.ep,
  );
  assert.equal(sorted[sorted.length - 1].ep, "Não informado");
});

test("frontend lazy boot", () => {
  const js = readFileSync(resolve(root, "js/internal-journey-bottlenecks.js"), "utf8");
  assert.match(js, /bootInternalJourneyBottlenecks/);
  assert.match(js, /internal-journey-bottlenecks/);
});

test("UX: blocos removidos e heatmap EP dropdown", () => {
  const js = readFileSync(resolve(root, "js/internal-journey-bottlenecks.js"), "utf8");
  assert.doesNotMatch(js, /Distribuição — onboarding completo/);
  assert.doesNotMatch(js, /Distribuição — primeira reunião/);
  assert.doesNotMatch(js, /Distribuição — dias desde última/);
  assert.doesNotMatch(js, /Associação com cancelamento/);
  assert.doesNotMatch(js, /Gargalos por programa/);
  assert.doesNotMatch(js, /Qualidade dos dados/);
  assert.match(js, /Há quanto tempo os clientes não fazem reunião/);
  assert.doesNotMatch(js, /Primeira reunião × conclusão do onboarding/);
  assert.doesNotMatch(js, /renderHeatmap/);
  assert.doesNotMatch(js, /ijb-heatmap/);
  assert.match(js, /ijbEpFilter/);
  assert.match(js, /Todos os EPs/);
  assert.match(js, /kpiPctPrimary/);
  assert.match(js, /Até 7 dias/);
  assert.match(js, /dos clientes observáveis/);
  assert.match(js, /meetingsRecencyBand/);
  assert.match(js, /30\+ dias sem reunião/);
  assert.match(js, /attentionPageSize: 10/);
  assert.match(js, /patchAttentionSection/);
  assert.match(js, /attentionClientsAll/);
  assert.doesNotMatch(js, /attentionPage.*searchParams|params\.set\("attentionPage"/);
  assert.doesNotMatch(js, /kpi\("p25"/i);
  assert.doesNotMatch(js, /kpi\("p75"/i);
  assert.match(js, /resolveEpWithoutMeetingFields/);
  assert.match(js, /% sem reunião/);
  assert.match(js, /epWithoutMeetingAlert|ijb-cell-alert/);
  assert.doesNotMatch(js, /epWithoutMeetingCount/);
  assert.match(js, /resolveAttentionClientsAll/);
  assert.match(js, /expectedAttentionClientsTotal/);
  assert.match(js, /epCellWithoutMeeting/);
  assert.match(js, /ijb-cell-alert/);
  assert.match(js, /window\.scrollTo/);
  assert.match(js, /ijb-table-wrap/);
});

test("handler registrado no router", () => {
  const router = readFileSync(resolve(root, "lib/api/dashboard-router.mjs"), "utf8");
  assert.match(router, /internal_journey_bottlenecks/);
  assert.match(router, /handleInternalJourneyBottlenecksRequest/);
});
