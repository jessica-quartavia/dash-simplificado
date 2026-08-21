import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createFilterChangeHandler,
  mergePeriodApply,
  officialPeriodState,
  periodFilterKey,
} from "../../lib/analytics/filters/filter-state.mjs";
import {
  defaultGeneralFilters,
  filterGeneralAcquisitionRows,
  filterGeneralClients,
} from "../../lib/analytics/general-filters.mjs";
import { filterOnboardingClients, defaultOnboardingFilters } from "../../lib/analytics/onboarding-filters.mjs";
import { applyMeetingFilters, defaultMeetingFilters } from "../../lib/analytics/meeting-filters.mjs";
import { filterPlanClients, defaultPlanFilters } from "../../lib/analytics/patrimonial-plan-filters.mjs";
import { filterMechanismMonthSeries, defaultMechanismFilters } from "../../lib/analytics/mechanism-filters.mjs";
import { bindFilterBar, renderFilterBar } from "../../js/components/filters/filter-bar.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = new Date("2026-08-20T15:00:00.000Z");
const FIELD = { kind: "period", id: "tPeriod", fromId: "tFrom", toId: "tTo" };

const GENERAL_ROWS = [
  { clientId: "1", analyticalStatus: "Ativo", contractDate: "2026-07-01", program: "Pharus" },
  { clientId: "2", analyticalStatus: "Ativo", contractDate: "2024-01-01", program: "Davos" },
];

test("A — custom range atualiza state oficial", () => {
  const state = officialPeriodState({ period: "custom", from: "2026-08-01", to: "2026-08-20" });
  assert.deepEqual(state, { preset: "custom", start: "2026-08-01", end: "2026-08-20" });
});

test("B — Apply dispara callback global com payload", () => {
  if (typeof document === "undefined") return;
  installDom();
  const host = document.createElement("div");
  host.innerHTML = renderFilterBar({ fields: [FIELD], filters: { period: "all", from: "", to: "" } });
  document.body.appendChild(host);
  let payload = null;
  const unbind = bindFilterBar({
    host,
    fields: [FIELD],
    filters: { period: "all", from: "", to: "" },
    onChange: (next) => {
      payload = next;
    },
  });
  host.querySelector("[data-drp-trigger]").click();
  host.querySelector('[data-drp-preset="last_30"]').click();
  host.querySelector("[data-drp-apply]").click();
  assert.equal(payload?.period, "last_30");
  unbind();
});

test("C — general acquisition recebe período quando applyPeriod", () => {
  const all = filterGeneralAcquisitionRows(GENERAL_ROWS, defaultGeneralFilters(), { now: NOW });
  const period = filterGeneralAcquisitionRows(
    GENERAL_ROWS,
    { ...defaultGeneralFilters(), period: "custom", from: "2026-06-01", to: "2026-08-20" },
    { now: NOW, applyPeriod: true },
  );
  assert.equal(all.length, 2);
  assert.equal(period.length, 1);
});

test("D — general active_clients ignora período por contrato", () => {
  const all = filterGeneralClients(GENERAL_ROWS, { ...defaultGeneralFilters(), status: "all" }, { now: NOW });
  const period = filterGeneralClients(
    GENERAL_ROWS,
    { ...defaultGeneralFilters(), status: "all", period: "custom", from: "2026-06-01", to: "2026-08-20" },
    { now: NOW },
  );
  assert.equal(all.length, period.length);
});

test("E — journey recebe contractDate range", () => {
  const rows = [
    { clientId: "1", contractDate: "2026-07-01" },
    { clientId: "2", contractDate: "2024-01-01" },
  ];
  const period = filterOnboardingClients(
    rows,
    { ...defaultOnboardingFilters(), status: "all", period: "custom", from: "2026-06-01", to: "2026-08-20" },
    { now: NOW },
  );
  assert.equal(period.length, 1);
});

test("F — meetings recebe start_time range", () => {
  const rows = [
    { clientId: "1", meetings: [{ startTime: "2026-07-20T12:00:00.000Z", meetingDateStatus: "valid" }] },
    { clientId: "2", meetings: [{ startTime: "2024-01-20T12:00:00.000Z", meetingDateStatus: "valid" }] },
  ];
  const period = applyMeetingFilters(
    rows,
    { ...defaultMeetingFilters(), status: "all", period: "custom", from: "2026-07-01", to: "2026-08-20" },
    { now: NOW },
  );
  assert.equal(period.length, 1);
});

test("G — patrimonial_plan recebe approvedAt range", () => {
  const rows = [
    { clientId: "1", approvedAt: "2026-07-01" },
    { clientId: "2", approvedAt: "2024-03-01" },
  ];
  const period = filterPlanClients(
    rows,
    { ...defaultPlanFilters(), period: "custom", from: "2026-06-01", to: "2026-08-01" },
    { now: NOW },
  );
  assert.equal(period.length, 1);
});

test("H — mechanisms monthly implementations recebe implemented_at range", () => {
  const clients = [
    {
      clientId: "1",
      clientName: "Ana",
      clientCode: "A1",
      analyticalStatus: "Ativo",
      engineer: "EP1",
      segment: "PRIVATE",
      mechanisms: [
        { mechanismId: "m1", name: "PGBL", status: "Implementado", implementedMonth: "2026-07", implementedAt: "2026-07-10T00:00:00.000Z" },
        { mechanismId: "m2", name: "PGBL", status: "Implementado", implementedMonth: "2024-01", implementedAt: "2024-01-10T00:00:00.000Z" },
      ],
    },
  ];
  const period = filterMechanismMonthSeries(
    clients,
    { ...defaultMechanismFilters(), period: "custom", from: "2026-07-01", to: "2026-08-20" },
    { now: NOW },
  );
  assert.equal(period.length, 1);
  assert.equal(period[0].label, "2026-07");
});

test("I — Limpar remove start/end", () => {
  const cleared = mergePeriodApply(
    { ...defaultGeneralFilters(), period: "custom", from: "2026-08-01", to: "2026-08-20" },
    { period: "all", from: "", to: "" },
  );
  assert.equal(cleared.period, "all");
  assert.equal(cleared.from, "");
  assert.equal(cleared.to, "");
  assert.equal(periodFilterKey(cleared), "all||");
});

test("handler oficial re-renderiza quando from/to mudam no mesmo preset", () => {
  const state = { filters: defaultGeneralFilters(), page: 3 };
  let renders = 0;
  const handler = createFilterChangeHandler({
    state,
    filtersFromForm: () => ({ ...defaultGeneralFilters(), period: "custom", from: "", to: "" }),
    renderFilters: () => {
      renders += 1;
    },
    renderSuccess: () => {},
  });
  handler({ period: "custom", from: "2026-08-01", to: "2026-08-20" });
  assert.equal(state.filters.from, "2026-08-01");
  assert.equal(state.filters.to, "2026-08-20");
  assert.equal(renders, 1);
  assert.equal(state.page, 1);
});

test("bindFilterBar repassa filters ao picker", () => {
  const source = readFileSync(resolve(root, "js/components/filters/filter-bar.js"), "utf8");
  assert.match(source, /filters = \{\}/);
  assert.match(source, /onApply: \(next\) => onChange\?\.\(next\)/);
});

function installDom() {
  if (typeof document === "undefined") return;
  document.body.innerHTML = "";
}
