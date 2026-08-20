/**
 * Filter Check: contrato + comportamento, não só HTML.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { implementedPageIds, PAGE_FILTER_CONTRACTS, pagesMissingFilterContract, pageShowsPeriodUi, resolveVisibleFilterFields } from "./page-contracts.mjs";
import { defaultGeneralFilters, filterGeneralAcquisitionRows, filterGeneralClients } from "../general-filters.mjs";
import { applyMeetingFilters, defaultMeetingFilters } from "../meeting-filters.mjs";
import { defaultOnboardingFilters, filterOnboardingClients } from "../onboarding-filters.mjs";
import { defaultPlanFilters, filterPlanClients } from "../patrimonial-plan-filters.mjs";
import { defaultMechanismFilters, filterMechanismClients, filterMechanismMonthSeries } from "../mechanism-filters.mjs";
import { officialPeriodState, mergePeriodApply, periodFilterKey } from "./filter-state.mjs";
import {
  normalizeProgramFilter,
  programSelectOptions,
  PROGRAM_ALLOWLIST,
} from "./program.mjs";
import { matchesSearch } from "./search.mjs";
import {
  applyPeriodPreset,
  defaultPeriodState,
  isFutureIso,
  normalizeCustomRange,
  normalizeRangeSelection,
  resolvePeriod,
  sanitizePeriodFilters,
  todayIso,
} from "./period.mjs";
import { buildCsv, buildExcelBuffer, projectExportRows } from "../../../js/utils/table-export.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NOW = new Date("2026-08-19T12:00:00.000Z");
const BUG_NOW = new Date("2026-08-20T15:00:00.000Z");

const GENERAL_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", analyticalStatus: "Ativo", segmentLabel: "PRIVATE", engineer: "Nícolas Alves", stayRange: "De 7 a 12 meses", contractDate: "2026-07-01", cancellationDate: null, program: "Pharus", monthlyIncome: 10000 },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", analyticalStatus: "Ativo", segmentLabel: "APEX", engineer: "Outro EP", stayRange: "Até 3 meses", contractDate: "2024-01-01", cancellationDate: null, program: "Davos", monthlyIncome: 8000 },
  { clientId: "3", clientName: "Carla", clientCode: "C3", analyticalStatus: "Congelado", segmentLabel: "PRIVATE", engineer: "Nícolas Alves", stayRange: "De 13 a 24 meses", contractDate: "2026-06-01", cancellationDate: null, program: "Pharus", monthlyIncome: 5000 },
  { clientId: "4", clientName: "Landlord Co", clientCode: "L4", analyticalStatus: "Ativo", segmentLabel: "PRIVATE", engineer: "Outro EP", stayRange: "Até 3 meses", contractDate: "2026-05-01", cancellationDate: null, program: "LANDLORD", monthlyIncome: 12000 },
];

const MEETING_FIXTURE = [
  {
    clientId: "1",
    clientName: "Ana Souza",
    clientCode: "A1",
    analyticalStatus: "Ativo",
    engineer: "Nícolas Alves",
    meetings: [{ meetingId: "m1", startTime: "2026-07-20T12:00:00.000Z", attendanceStatus: "compareceu", rescheduled: false, meetingDateStatus: "valid" }],
    hasValidMeeting: true,
    firstMeetingCompleted: true,
    absences: 0,
    reschedules: 0,
    frequencyBand: "1 reunião",
  },
  {
    clientId: "2",
    clientName: "João Lima",
    clientCode: "B2",
    analyticalStatus: "Ativo",
    engineer: "Outro EP",
    meetings: [{ meetingId: "m2", startTime: "2025-01-20T12:00:00.000Z", attendanceStatus: "compareceu", rescheduled: false, meetingDateStatus: "valid" }],
    hasValidMeeting: true,
    firstMeetingCompleted: true,
    absences: 0,
    reschedules: 0,
    frequencyBand: "1 reunião",
  },
];

const JOURNEY_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", analyticalStatus: "Ativo", engineer: "Nícolas Alves", contractDate: "2026-07-01", completedOnboarding: true },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", analyticalStatus: "Ativo", engineer: "Outro EP", contractDate: "2024-01-01", completedOnboarding: false },
];

const PLAN_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", engineer: "Nícolas Alves", contractDate: "2026-01-01", approvedAt: "2026-07-01", daysToApproval: 181 },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", engineer: "Outro EP", contractDate: "2024-01-01", approvedAt: "2024-03-01", daysToApproval: 60 },
];

const MECH_FIXTURE = [
  {
    clientId: "1",
    clientName: "Ana Souza",
    clientCode: "A1",
    analyticalStatus: "Ativo",
    engineer: "Nícolas Alves",
    segment: "PRIVATE",
    available: 2,
    implemented: 1,
    implementationPercent: 50,
    hasImplementationLast30Days: true,
    mechanismsCountBand: "2",
    percentRange: "De 26% a 50%",
    mechanisms: [
      { mechanismId: "m1", name: "PGBL", status: "Implementado", dimension: "Previdência", implementedMonth: "2026-07", implementedAt: "2026-07-10T00:00:00.000Z" },
      { mechanismId: "m2", name: "Seguro", status: "Apto", dimension: "Proteção", implementedMonth: null, implementedAt: null },
    ],
  },
  {
    clientId: "2",
    clientName: "João Lima",
    clientCode: "B2",
    analyticalStatus: "Ativo",
    engineer: "Outro EP",
    segment: "APEX",
    available: 1,
    implemented: 1,
    implementationPercent: 100,
    hasImplementationLast30Days: false,
    mechanismsCountBand: "1",
    percentRange: "100%",
    mechanisms: [
      { mechanismId: "m1", name: "PGBL", status: "Implementado", dimension: "Previdência", implementedMonth: "2024-01", implementedAt: "2024-01-10T00:00:00.000Z" },
    ],
  },
];

function pass(id, ok, detail = "") {
  return { id, ok, detail };
}

function checkDateRangePicker() {
  const pickerPath = resolve(root, "js/components/filters/date-range-picker.js");
  const filterBarPath = resolve(root, "js/components/filters/filter-bar.js");
  const filterBarSource = existsSync(filterBarPath) ? readFileSync(filterBarPath, "utf8") : "";
  const filterStatePath = resolve(root, "lib/analytics/filters/filter-state.mjs");
  const programPath = resolve(root, "lib/analytics/filters/program.mjs");
  const today = todayIso(BUG_NOW);
  const tomorrow = "2026-08-21";
  const swapped = normalizeRangeSelection("2026-08-15", "2026-08-10", BUG_NOW);
  const preset30 = applyPeriodPreset("last_30", BUG_NOW);
  const preset6m = applyPeriodPreset("last_6m", BUG_NOW);
  const presetYear = applyPeriodPreset("this_year", BUG_NOW);
  const presetAll = applyPeriodPreset("all", BUG_NOW);
  const cleared = defaultPeriodState();
  const futureManual = sanitizePeriodFilters({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  const invertedResolved = resolvePeriod({ period: "custom", from: "2026-08-01", to: "2026-01-01" }, NOW);
  const futureResolved = resolvePeriod({ period: "custom", from: "2027-08-19", to: "2026-08-20" }, BUG_NOW);
  const customResolved = resolvePeriod({ period: "custom", from: "2026-08-05", to: "2026-08-20" }, BUG_NOW);
  const combined = filterGeneralClients(
    GENERAL_FIXTURE,
    { ...defaultGeneralFilters(), period: "custom", from: "2026-07-01", to: "2026-08-01", engineer: "Nícolas Alves" },
    { now: BUG_NOW },
  );
  const customState = officialPeriodState({ period: "custom", from: "2026-08-01", to: "2026-08-20" });
  const merged = mergePeriodApply(defaultGeneralFilters(), { period: "custom", from: "2026-08-01", to: "2026-08-20" });
  const acqCustom = filterGeneralAcquisitionRows(
    GENERAL_FIXTURE,
    { ...defaultGeneralFilters(), status: "all", period: "custom", from: "2026-08-01", to: "2026-08-20" },
    { now: BUG_NOW },
  );
  const acqAll = filterGeneralAcquisitionRows(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all" }, { now: BUG_NOW });
  const stockCustom = filterGeneralClients(
    GENERAL_FIXTURE,
    { ...defaultGeneralFilters(), status: "all", period: "custom", from: "2026-08-01", to: "2026-08-20" },
    { now: BUG_NOW },
  );
  const stockAll = filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all" }, { now: BUG_NOW });
  const clearedKey = periodFilterKey(defaultGeneralFilters());

  const cssPath = resolve(root, "css/components.css");
  const cssSource = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const indexHtml = existsSync(resolve(root, "index.html")) ? readFileSync(resolve(root, "index.html"), "utf8") : "";
  const pickerSource = existsSync(pickerPath) ? readFileSync(pickerPath, "utf8") : "";
  const layoutOk =
    cssSource.includes("overflow: visible")
    && cssSource.includes(".drp-popover[hidden]")
    && cssSource.includes("min-width: 0")
    && !cssSource.includes("min-width: 220px")
    && !cssSource.includes("isolation: isolate");

  return [
    pass("date_range_picker_exists", existsSync(pickerPath) && filterBarSource.includes("renderDateRangePicker")),
    pass("closed_field_layout", layoutOk),
    pass("popover_no_clipping", indexHtml.includes('id="overlay-root"') && pickerSource.includes("mountPopoverPortal")),
    pass("popover_above_content", cssSource.includes("--z-overlay") && cssSource.includes(".drp-popover--portal")),
    pass("popover_in_viewport", pickerSource.includes("positionAnchoredPopover")),
    pass("outside_click_closes", pickerSource.includes("createOverlayBackdrop") || pickerSource.includes("onDismiss")),
    pass("overlay_removed_on_close", pickerSource.includes("unmountPopoverPortal")),
    pass("scroll_resize_handled", pickerSource.includes("onViewportChange")),
    pass("mobile_sheet", cssSource.includes("drp-popover--mobile")),
    pass("start_end_selection", swapped.start === "2026-08-10" && swapped.end === "2026-08-15"),
    pass("today_allowed", !isFutureIso(today, BUG_NOW)),
    pass("future_blocked", isFutureIso("2027-08-19", BUG_NOW) && isFutureIso(tomorrow, BUG_NOW)),
    pass("range_works", normalizeCustomRange("2026-08-05", "2026-08-12", BUG_NOW).ok === true),
    pass("preset_works", preset30.period === "last_30" && preset6m.period === "last_6m"),
    pass("clear_works", cleared.period === "all" && cleared.from === "" && cleared.to === ""),
    pass("period_reaches_filter", customResolved.active === true && !customResolved.invalid),
    pass("period_sensitive_respected", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), period: "last_6m" }, { now: NOW }).length === filterGeneralClients(GENERAL_FIXTURE, defaultGeneralFilters()).length),
    pass("filters_combine_period", combined.length === 1 && combined[0].clientId === "1"),
    pass("inverted_range_corrected", invertedResolved.active === true && !invertedResolved.invalid),
    pass("future_manual_rejected", futureManual.period === "all" && futureResolved.invalid === true),
    pass("preset_all", presetAll.period === "all"),
    pass("preset_this_year", presetYear.period === "this_year"),
    pass("picker_syncs_state", customState.preset === "custom" && customState.start === "2026-08-01" && customState.end === "2026-08-20"),
    pass("apply_merges_filters", merged.period === "custom" && merged.from === "2026-08-01" && merged.to === "2026-08-20"),
    pass("filterbar_passes_filters", filterBarSource.includes("filters,") && filterBarSource.includes("onApply: (next) => onChange?.(next)")),
    pass("picker_reads_dom_before_reset", pickerSource.includes("readPeriodFieldValues(field)")),
    pass("period_on_sensitive_component", acqCustom.length < acqAll.length),
    pass("period_off_stock_component", stockCustom.length === stockAll.length),
    pass("clear_period_key", clearedKey === "all||"),
    pass("program_allowlist_module", existsSync(programPath) && PROGRAM_ALLOWLIST.join(",") === "Pharus,Davos"),
    pass("program_select_options", programSelectOptions(GENERAL_FIXTURE).join(",") === "Pharus,Davos"),
    pass("program_landlord_hidden", !programSelectOptions(GENERAL_FIXTURE).includes("LANDLORD")),
    pass("program_normalize_case", normalizeProgramFilter(" pharus ") === "Pharus" && normalizeProgramFilter("DAVOS") === "Davos"),
    pass("program_pharus_filter", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "Pharus" }).length === 2),
    pass("program_davos_filter", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "Davos" }).length === 1),
    pass("program_landlord_no_match", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "LANDLORD" }).length === 4),
    pass("filter_state_module", existsSync(filterStatePath)),
  ];
}

function checkContractShape(contract) {
  const checks = [];
  checks.push(pass("period_exists", Boolean(contract.period?.required && contract.period?.semantics), contract.period?.semantics || "semântica ausente"));
  checks.push(pass("search_exists", Boolean(contract.search?.tables?.length), "tabelas de busca"));
  checks.push(pass("search_name", Boolean(contract.search?.fields?.name), contract.search?.fields?.name || "nome ausente"));
  checks.push(pass("search_id", Boolean(contract.search?.fields?.id), contract.search?.fields?.id || "id ausente"));
  checks.push(pass("search_code", contract.search?.codeAvailable ? Boolean(contract.search?.fields?.code) : true, contract.search?.codeAvailable ? contract.search.codeSource : "código não disponível na fonte"));
  checks.push(pass("csv", contract.export?.formats?.includes("csv")));
  checks.push(pass("excel", contract.export?.formats?.includes("xlsx")));
  checks.push(pass("kpi_declares_filters", contract.components.filter((c) => c.type === "kpi").every((c) => c.filters)));
  checks.push(pass("chart_declares_filters", contract.components.filter((c) => c.type === "chart").every((c) => c.filters)));
  checks.push(pass("table_declares_filters", contract.components.filter((c) => c.type === "table").every((c) => c.filters)));
  checks.push(pass("no_unimplemented_visual", (contract.unimplementedVisualFilters || []).length === 0, (contract.unimplementedVisualFilters || []).join(", ")));
  checks.push(pass("period_semantics", Boolean(contract.period?.semantics)));
  checks.push(pass("period_sensitive_identified", contract.components.some((c) => c.periodSensitive === false) || contract.components.every((c) => c.periodSensitive === true)));
  return checks;
}

function checkSearch(rows) {
  const byName = rows.filter((row) => matchesSearch(row, "Ana"));
  const byAccent = rows.filter((row) => matchesSearch(row, "Joao"));
  const byId = rows.filter((row) => matchesSearch(row, "1"));
  const byCode = rows.filter((row) => matchesSearch(row, "A1"));
  return [
    pass("search_name", byName.length >= 1 && byName.every((row) => /ana/i.test(row.clientName))),
    pass("search_accent", byAccent.some((row) => row.clientId === "2")),
    pass("search_id", byId.some((row) => row.clientId === "1")),
    pass("search_code", byCode.some((row) => row.clientCode === "A1")),
  ];
}

function checkExport(rows, columns, filters) {
  const csv = buildCsv({ rows, columns });
  const xlsx = buildExcelBuffer({ rows, columns, filters });
  const projected = projectExportRows(rows, columns);
  const csvHasJoao = csv.includes("João") || csv.includes("Joao");
  return [
    pass("export_filtered", projected.length === rows.length && !csvHasJoao === !rows.some((row) => row.clientName?.includes("João"))),
    pass("export_allowlist", projected.every((row) => Object.keys(row).every((key) => columns.some((col) => col.header === key)))),
    pass("xlsx_real", xlsx instanceof Uint8Array && xlsx[0] === 0x50 && xlsx[1] === 0x4b),
  ];
}

export function runPageBehavior(pageId) {
  const contract = PAGE_FILTER_CONTRACTS[pageId];
  if (!contract) return [pass("contract", false, "Filter Contract ausente")];
  const checks = [...checkContractShape(contract)];

  if (pageId === "general") {
    const base = filterGeneralClients(GENERAL_FIXTURE, defaultGeneralFilters());
    const ep = filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), engineer: "Nícolas Alves" });
    const periodStock = filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), period: "last_6m" }, { now: NOW });
    const acqAll = filterGeneralAcquisitionRows(GENERAL_FIXTURE, defaultGeneralFilters(), { now: NOW });
    const acqPeriod = filterGeneralAcquisitionRows(GENERAL_FIXTURE, { ...defaultGeneralFilters(), period: "last_6m" }, { now: NOW });
    const acqCustom = filterGeneralAcquisitionRows(
      GENERAL_FIXTURE,
      { ...defaultGeneralFilters(), status: "all", period: "custom", from: "2026-08-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    const combined = filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), engineer: "Nícolas Alves", search: "Ana" });
    checks.push(pass("filter_changes_component", ep.length === 1 && ep[0].engineer === "Nícolas Alves" && ep.length !== filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all" }).length));
    checks.push(pass("period_not_on_stock", periodStock.length === base.length));
    checks.push(pass("period_on_acquisition", acqPeriod.length < acqAll.length && acqPeriod.every((row) => row.contractDate >= "2026-02-19")));
    checks.push(pass("custom_period_on_acquisition", acqCustom.length < acqAll.length));
    checks.push(pass("filters_combine", combined.length === 1 && combined[0].clientId === "1"));
    checks.push(...checkSearch(GENERAL_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "meetings") {
    const all = applyMeetingFilters(MEETING_FIXTURE, { ...defaultMeetingFilters(), status: "all" }, { now: NOW });
    const period = applyMeetingFilters(MEETING_FIXTURE, { ...defaultMeetingFilters(), status: "all", period: "last_6m" }, { now: NOW });
    const customPeriod = applyMeetingFilters(
      MEETING_FIXTURE,
      { ...defaultMeetingFilters(), status: "all", period: "custom", from: "2026-07-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    const ep = applyMeetingFilters(MEETING_FIXTURE, { ...defaultMeetingFilters(), status: "all", engineer: "Nícolas Alves" }, { now: NOW });
    const corrected = resolvePeriod({ period: "custom", from: "2026-08-01", to: "2026-01-01" }, NOW);
    checks.push(pass("filter_changes_component", ep.length === 1));
    checks.push(pass("period_preset", period.length === 1 && period[0].clientId === "1"));
    checks.push(pass("custom_period_start_time", customPeriod.length === 1 && customPeriod[0].clientId === "1"));
    checks.push(pass("custom_range_corrected", corrected.active === true && !corrected.invalid));
    checks.push(...checkSearch(MEETING_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
    checks.push(pass("filters_combine", applyMeetingFilters(MEETING_FIXTURE, { ...defaultMeetingFilters(), status: "all", engineer: "Nícolas Alves", search: "Ana" }, { now: NOW }).length === 1));
    void all;
  }

  if (pageId === "journey") {
    const all = filterOnboardingClients(JOURNEY_FIXTURE, { ...defaultOnboardingFilters(), status: "all" });
    const period = filterOnboardingClients(JOURNEY_FIXTURE, { ...defaultOnboardingFilters(), status: "all", period: "last_6m" }, { now: NOW });
    const customPeriod = filterOnboardingClients(
      JOURNEY_FIXTURE,
      { ...defaultOnboardingFilters(), status: "all", period: "custom", from: "2026-06-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    const ep = filterOnboardingClients(JOURNEY_FIXTURE, { ...defaultOnboardingFilters(), status: "all", engineer: "Nícolas Alves" });
    checks.push(pass("filter_changes_component", ep.length === 1));
    checks.push(pass("period_cohort", period.length === 1 && period[0].clientId === "1"));
    checks.push(pass("custom_period_contract_date", customPeriod.length === 1 && customPeriod[0].clientId === "1"));
    checks.push(pass("filters_combine", filterOnboardingClients(JOURNEY_FIXTURE, { ...defaultOnboardingFilters(), status: "all", engineer: "Nícolas Alves", search: "Ana" }).length === 1));
    checks.push(...checkSearch(JOURNEY_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
    void all;
  }

  if (pageId === "patrimonial_plan") {
    const all = filterPlanClients(PLAN_FIXTURE, defaultPlanFilters());
    const period = filterPlanClients(PLAN_FIXTURE, { ...defaultPlanFilters(), period: "last_6m" }, { now: NOW });
    const customPeriod = filterPlanClients(
      PLAN_FIXTURE,
      { ...defaultPlanFilters(), period: "custom", from: "2026-06-01", to: "2026-08-01" },
      { now: BUG_NOW },
    );
    const ep = filterPlanClients(PLAN_FIXTURE, { ...defaultPlanFilters(), engineer: "Nícolas Alves" });
    checks.push(pass("filter_changes_component", ep.length === 1 && ep[0].daysToApproval === 181));
    checks.push(pass("period_on_central_date", period.length === 1 && period[0].clientId === "1"));
    checks.push(pass("custom_period_approved_at", customPeriod.length === 1 && customPeriod[0].clientId === "1"));
    checks.push(pass("not_active_first", !contract.uiFilters.includes("status")));
    checks.push(...checkSearch(PLAN_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
    void all;
  }

  if (pageId === "mechanisms") {
    const stock = filterMechanismClients(MECH_FIXTURE, defaultMechanismFilters());
    const periodStock = filterMechanismClients(MECH_FIXTURE, { ...defaultMechanismFilters(), period: "last_6m" }, { now: NOW });
    const monthsAll = filterMechanismMonthSeries(MECH_FIXTURE, defaultMechanismFilters(), { now: NOW });
    const monthsPeriod = filterMechanismMonthSeries(MECH_FIXTURE, { ...defaultMechanismFilters(), period: "last_6m" }, { now: NOW });
    const monthsCustom = filterMechanismMonthSeries(
      MECH_FIXTURE,
      { ...defaultMechanismFilters(), period: "custom", from: "2026-07-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    const ep = filterMechanismClients(MECH_FIXTURE, { ...defaultMechanismFilters(), engineer: "Nícolas Alves" });
    checks.push(pass("filter_changes_component", ep.length === 1));
    checks.push(pass("period_not_on_stock", periodStock.length === stock.length));
    checks.push(pass("period_on_months", monthsPeriod.length < monthsAll.length || monthsPeriod.every((item) => item.label.startsWith("2026"))));
    checks.push(pass("custom_period_implemented_at", monthsCustom.length === 1 && monthsCustom[0].label === "2026-07"));
    checks.push(...checkSearch(MECH_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  const cleared = pageId === "meetings"
    ? defaultMeetingFilters()
    : pageId === "journey"
      ? defaultOnboardingFilters()
      : pageId === "patrimonial_plan"
        ? defaultPlanFilters()
        : pageId === "mechanisms"
          ? defaultMechanismFilters()
          : defaultGeneralFilters();
  checks.push(pass("clear_filters", cleared.search === "" && cleared.period === "all" && !cleared.from && !cleared.to));
  checks.push(pass("period_ui_expected", pageShowsPeriodUi(pageId) === (pageId === "meetings"), pageShowsPeriodUi(pageId) ? "com período" : "sem período"));
  return checks;
}

function checkUxAdjustments() {
  const filterShellPath = resolve(root, "js/components/filters/filter-shell.js");
  const scrollTopPath = resolve(root, "js/components/scroll-to-top.js");
  const assistantPath = resolve(root, "js/assistant/assistant-ui.js");
  const appPath = resolve(root, "js/app.js");
  const cssPath = resolve(root, "css/components.css");
  const assistantCssPath = resolve(root, "css/assistant.css");
  const generalJs = readFileSync(resolve(root, "js/general-data.js"), "utf8");
  const shellSource = existsSync(filterShellPath) ? readFileSync(filterShellPath, "utf8") : "";
  const scrollSource = existsSync(scrollTopPath) ? readFileSync(scrollTopPath, "utf8") : "";
  const assistantSource = existsSync(assistantPath) ? readFileSync(assistantPath, "utf8") : "";
  const appSource = existsSync(appPath) ? readFileSync(appPath, "utf8") : "";
  const cssSource = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const assistantCss = existsSync(assistantCssPath) ? readFileSync(assistantCssPath, "utf8") : "";
  const stylesCss = readFileSync(resolve(root, "css/styles.css"), "utf8");
  const sampleCatalog = [
    { kind: "search", key: "search" },
    { kind: "period", key: "period" },
    { kind: "select", key: "status" },
  ];

  return [
    pass("general_no_period_ui", !pageShowsPeriodUi("general") && resolveVisibleFilterFields("general", sampleCatalog).length === 2),
    pass("journey_no_period_ui", !pageShowsPeriodUi("journey")),
    pass("meetings_period_ui", pageShowsPeriodUi("meetings") && resolveVisibleFilterFields("meetings", sampleCatalog).length === 3),
    pass("plan_no_period_ui", !pageShowsPeriodUi("patrimonial_plan")),
    pass("mechanisms_no_period_ui", !pageShowsPeriodUi("mechanisms")),
    pass("pages_use_contract_fields", generalJs.includes("resolveVisibleFilterFields")),
    pass("sticky_toggle_visible", shellSource.includes("Fixar filtros ao rolar") && shellSource.includes("data-filter-sticky")),
    pass("sticky_persisted", shellSource.includes("sessionStorage") && shellSource.includes("readStickyPinned")),
    pass("sticky_layout_css", cssSource.includes(".page-filters.is-sticky-pinned") && cssSource.includes("position: sticky") && cssSource.includes("overflow: visible")),
    pass("sticky_shadow", cssSource.includes(".page-filters.is-sticky-pinned.is-stuck")),
    pass("sticky_host_not_inner_shell", shellSource.includes("host.classList.toggle(\"is-sticky-pinned\"") && cssSource.includes(".page-filters.is-sticky-pinned")),
    pass("sticky_scroll_target", shellSource.includes("resolveFilterScrollTarget")),
    pass("sticky_z_below_overlay", stylesCss.includes("--z-filter-sticky") && stylesCss.includes("--z-overlay")),
    pass("assistant_aligned_v2", assistantCss.includes("background: var(--surface)") && !assistantCss.includes("assistant-fab-gold") && !assistantSource.includes("assistant-fab-gold")),
    pass("assistant_no_robot", !assistantSource.includes("assistant-fab-icon") && !assistantSource.includes("ROBOT_ICON")),
    pass("scroll_top_boot", appSource.includes("bootScrollToTop") && scrollSource.includes('behavior: "smooth"')),
    pass("chat_header_icons", assistantSource.includes('aria-label="Nova conversa"') && assistantSource.includes('aria-label="Fechar assistente"') && !assistantSource.includes(">Nova conversa<")),
    pass("chip_auto_send", assistantSource.includes("await sendMessage") && assistantSource.includes("lastChipSentAt")),
  ];
}

export function runFilterCheck() {
  const missing = pagesMissingFilterContract();
  const pages = {};
  let failed = missing.length > 0;
  for (const pageId of implementedPageIds()) {
    const checks = runPageBehavior(pageId);
    const ok = checks.every((item) => item.ok);
    if (!ok) failed = true;
    pages[pageId] = { ok, checks };
  }
  const dateRangeChecks = checkDateRangePicker();
  const dateRangeOk = dateRangeChecks.every((item) => item.ok);
  if (!dateRangeOk) failed = true;
  const uxChecks = checkUxAdjustments();
  const uxOk = uxChecks.every((item) => item.ok);
  if (!uxOk) failed = true;
  return {
    ok: !failed,
    missingContracts: missing,
    pages,
    dateRange: { ok: dateRangeOk, checks: dateRangeChecks },
    ux: { ok: uxOk, checks: uxChecks },
  };
}
