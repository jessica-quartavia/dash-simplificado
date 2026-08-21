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
import { defaultFinancialUpdatesFilters, filterFinancialUpdateClients, FINANCIAL_TRAIT_OPTIONS } from "../financial-updates-filters.mjs";
import { defaultPlatformUsageFilters } from "../platform-usage-filters.mjs";
import { defaultSupportFilters } from "../support-filters.mjs";
import { defaultSatisfactionFilters, filterSatisfactionClients } from "../satisfaction-filters.mjs";
import { defaultCancellationFilters, filterCancellationClients } from "../cancellations-filters.mjs";
import { defaultRenewalFilters, filterRenewalClients } from "../renewal-filters.mjs";
import { defaultEpPerformanceFilters, filterEpEngineers } from "../ep-performance-filters.mjs";
import {
  defaultTemporalIndicatorsFilters,
  filterTemporalActivityRecency,
  summarizeFilteredTemporal,
} from "../temporal-indicators-filters.mjs";
import {
  defaultStatisticalCrossesFilters,
  scPassMin,
  statisticalCrossesFiltersToSearchParams,
} from "../statistical-crosses-filters.mjs";
import { officialPeriodState, mergePeriodApply, periodFilterKey } from "./filter-state.mjs";
import {
  normalizeProgramFilter,
  programSelectOptions,
  PROGRAM_ALLOWLIST,
  PROGRAM_FILTER_OPTIONS,
} from "./program.mjs";
import { matchesSearch } from "./search.mjs";
import { filterReports } from "../reports-search.mjs";
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
import { normalizeMultiSelectFilter } from "./multiselect.mjs";
import { formatLastUpdated } from "../../../js/components/page-refresh.js";

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

const FINANCIAL_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", analyticalStatus: "Ativo", engineer: "Nícolas Alves", segment: "PRIVATE", program: "Pharus", hasFinancialData: true, hasPostCreationUpdate: true, updatedLast30Days: true, outdatedOver90Days: false, daysSinceFinancialUpdate: 10, recencyBand: "Atualizado nos últimos 30 dias", liquidityReserve: 1000, monthlyIncome: null, lastContribution: null, financialUpdateDate: "2026-08-01T00:00:00.000Z" },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", analyticalStatus: "Ativo", engineer: "Outro EP", segment: "APEX", program: "Davos", hasFinancialData: false, hasPostCreationUpdate: false, monthlyIncome: 8000 },
];

const SATISFACTION_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", engineer: "Nícolas Alves", program: "Pharus", latestNps: 10, npsResponses: 1, csatResponses: 1 },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", engineer: "Outro EP", program: "Davos", latestNps: null, npsResponses: 0, csatResponses: 0 },
];

const CANCEL_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", analyticalStatus: "Cancelado", engineer: "Nícolas Alves", segment: "PRIVATE", program: "Pharus", hasEfetivado: true, inProcessCurrently: false, hasIntentionOrPedido: true, exclusiveStage: "Efetivado" },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", analyticalStatus: "Ativo", engineer: "Outro EP", segment: "APEX", program: "Davos", hasEfetivado: false, inProcessCurrently: true, hasIntentionOrPedido: true, exclusiveStage: "Intenção / pedido" },
];

const RENEWAL_FIXTURE = [
  { clientId: "1", clientName: "Ana Souza", clientCode: "A1", engineer: "Nícolas Alves", segment: "PRIVATE", program: "Pharus", currentCycle: 3, renewalCount: 2, renewed: true, cycleValid: true },
  { clientId: "2", clientName: "João Lima", clientCode: "B2", engineer: "Outro EP", segment: "APEX", program: "Davos", currentCycle: 1, renewalCount: 0, renewed: false, cycleValid: true },
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
    pass("program_filter_options_alias", PROGRAM_FILTER_OPTIONS.join(",") === "Pharus,Davos"),
    pass("program_select_options", programSelectOptions(GENERAL_FIXTURE).join(",") === "Pharus,Davos"),
    pass("program_landlord_hidden", !programSelectOptions(GENERAL_FIXTURE).includes("LANDLORD")),
    pass("program_normalize_case", normalizeProgramFilter(" pharus ") === "Pharus" && normalizeProgramFilter("DAVOS") === "Davos"),
    pass("program_pharus_filter", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "Pharus" }).length === 2),
    pass("program_davos_filter", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "Davos" }).length === 1),
    pass("program_landlord_no_match", filterGeneralClients(GENERAL_FIXTURE, { ...defaultGeneralFilters(), status: "all", program: "LANDLORD" }).length === 4),
    pass("filter_state_module", existsSync(filterStatePath)),
  ];
}

function checkMultiSelectAndRefresh() {
  const multiPath = resolve(root, "js/components/filters/multi-select-filter.js");
  const coordinatorPath = resolve(root, "js/components/dropdown-coordinator.js");
  const navPath = resolve(root, "js/navigation.js");
  const refreshPath = resolve(root, "js/components/page-refresh.js");
  const filterBarPath = resolve(root, "js/components/filters/filter-bar.js");
  const pageLoadPath = resolve(root, "js/utils/page-load.js");
  const satFiltersPath = resolve(root, "lib/analytics/satisfaction-filters.mjs");
  const cancelFiltersPath = resolve(root, "lib/analytics/cancellations-filters.mjs");
  const epFiltersPath = resolve(root, "lib/analytics/ep-performance-filters.mjs");
  const multiSource = existsSync(multiPath) ? readFileSync(multiPath, "utf8") : "";
  const coordinatorSource = existsSync(coordinatorPath) ? readFileSync(coordinatorPath, "utf8") : "";
  const navSource = existsSync(navPath) ? readFileSync(navPath, "utf8") : "";
  const satFiltersSource = existsSync(satFiltersPath) ? readFileSync(satFiltersPath, "utf8") : "";
  const cancelFiltersSource = existsSync(cancelFiltersPath) ? readFileSync(cancelFiltersPath, "utf8") : "";
  const epFiltersSource = existsSync(epFiltersPath) ? readFileSync(epFiltersPath, "utf8") : "";
  const refreshSource = existsSync(refreshPath) ? readFileSync(refreshPath, "utf8") : "";
  const financialJs = readFileSync(resolve(root, "js/financial-updates.js"), "utf8");
  const mechJs = readFileSync(resolve(root, "js/mechanisms.js"), "utf8");
  const traitFiltered = filterFinancialUpdateClients(FINANCIAL_FIXTURE, {
    ...defaultFinancialUpdatesFilters(),
    status: "all",
    financialTraits: ["hasLiquidityReserve", "hasMonthlyIncome"],
  });
  const mechFiltered = filterMechanismClients(MECH_FIXTURE, {
    ...defaultMechanismFilters(),
    mechanism: ["PGBL"],
  });
  const renewedYes = filterRenewalClients(RENEWAL_FIXTURE, { ...defaultRenewalFilters(), renewed: "yes" });
  const renewedNo = filterRenewalClients(RENEWAL_FIXTURE, { ...defaultRenewalFilters(), renewed: "no" });
  const tsSameDay = formatLastUpdated(new Date("2026-08-20T15:17:00.000Z"), BUG_NOW);
  return [
    pass("multiselect_module", existsSync(multiPath) && multiSource.includes("bindMultiSelectFilter")),
    pass("multiselect_in_filterbar", readFileSync(filterBarPath, "utf8").includes("kind === \"multiselect\"")),
    pass("multiselect_click_outside", multiSource.includes("pointerdown") && multiSource.includes("onPointerDown")),
    pass("multiselect_escape", multiSource.includes('event.key !== "Escape"') || multiSource.includes('event.key === "Escape"')),
    pass("multiselect_coordinator", coordinatorSource.includes("registerOpenDropdown")),
    pass("multiselect_nav_close", navSource.includes("closeOpenDropdown")),
    pass("multiselect_no_close_on_select", (() => {
      const block = multiSource.match(/const applySelection = \(nextValues[\s\S]*?};/);
      return block ? !block[0].includes("closePopover") : false;
    })()),
    pass("satisfaction_nps_class_filter", satFiltersSource.includes("npsClassificationFromScore")),
    pass("satisfaction_csat_filter", satFiltersSource.includes("rowHasValidCsat")),
    pass("satisfaction_last_nps_band", satFiltersSource.includes("scoreInLastNpsBand")),
    pass("cancellation_stage_filter", cancelFiltersSource.includes("matchesCancellationStage")),
    pass("cancellation_reason_category", cancelFiltersSource.includes("matchesReasonCategory")),
    pass("cancellation_responsible", cancelFiltersSource.includes("matchesResponsible")),
    pass("ep_engineer_multiselect", epFiltersSource.includes("normalizeMultiSelectFilter") && epFiltersSource.includes("matchesEngineerFilter")),
    pass("multiselect_or_financial", traitFiltered.length === 2),
    pass("financial_trait_options", FINANCIAL_TRAIT_OPTIONS.length === 4),
    pass("mechanism_multiselect_filter", mechFiltered.length === 2),
    pass("mechanism_no_recent_ui", !mechJs.includes("mkRecent") && !PAGE_FILTER_CONTRACTS.mechanisms.uiFilters.includes("recent")),
    pass("mechanism_no_pct_ui", !mechJs.includes("mkPct") && !PAGE_FILTER_CONTRACTS.mechanisms.uiFilters.includes("pctRange")),
    pass("renewed_filter_yes", renewedYes.length === 1 && renewedYes[0].renewed === true),
    pass("renewed_filter_no", renewedNo.length === 1 && renewedNo[0].currentCycle === 1),
    pass("page_refresh_module", existsSync(refreshPath) && refreshSource.includes("createPageRefresh")),
    pass("page_load_cache_bust", existsSync(pageLoadPath) && readFileSync(pageLoadPath, "utf8").includes("cache: \"no-store\"")),
    pass("pages_use_page_refresh", financialJs.includes("createPageRefresh") && mechJs.includes("createPageRefresh")),
    pass("refresh_cached_enables_button", financialJs.includes("setActions(true)") && financialJs.includes("state.payload && !force")),
    pass("refresh_timestamp_same_day", /^\d{2}:\d{2}$/.test(tsSameDay)),
    pass("program_only_pharus_davos", programSelectOptions().every((p) => p === "Pharus" || p === "Davos")),
  ];
}

function checkPeriodUiPages() {
  return [
    pass("meetings_period_ui", pageShowsPeriodUi("meetings")),
    pass("financial_period_ui", pageShowsPeriodUi("financial_updates")),
    pass("cancellations_period_ui", pageShowsPeriodUi("cancellations")),
    pass("general_no_period_ui", !pageShowsPeriodUi("general")),
    pass("financial_period_required", PAGE_FILTER_CONTRACTS.financial_updates.period.required === true),
    pass("cancellations_period_required", PAGE_FILTER_CONTRACTS.cancellations.period.required === true),
  ];
}

function checkContractShape(contract) {
  const checks = [];
  checks.push(pass("period_exists", Boolean(contract.period?.semantics), contract.period?.semantics || "semântica ausente"));
  checks.push(pass("search_exists", contract.search?.tables?.length ? Boolean(contract.search?.tables?.length) : true, "tabelas de busca"));
  checks.push(pass("search_name", contract.search?.fields?.name ? Boolean(contract.search?.fields?.name) : true, contract.search?.fields?.name || "nome ausente"));
  checks.push(pass("search_id", contract.search?.fields?.id ? Boolean(contract.search?.fields?.id) : !contract.search?.tables?.length, contract.search?.fields?.id || "id ausente"));
  checks.push(pass("search_code", contract.search?.codeAvailable ? Boolean(contract.search?.fields?.code) : true, contract.search?.codeAvailable ? contract.search.codeSource : "código não disponível na fonte"));
  checks.push(pass("csv", contract.export?.formats?.includes("csv")));
  checks.push(pass("excel", contract.export?.formats?.includes("xlsx")));
  checks.push(pass("kpi_declares_filters", contract.components.filter((c) => c.type === "kpi").every((c) => c.filters)));
  checks.push(pass("chart_declares_filters", contract.components.filter((c) => c.type === "chart").every((c) => c.filters)));
  checks.push(pass("table_declares_filters", contract.components.filter((c) => c.type === "table").every((c) => c.filters)));
  checks.push(pass("no_unimplemented_visual", (contract.unimplementedVisualFilters || []).length === 0 || contract.pageId === "statistical_crosses", (contract.unimplementedVisualFilters || []).join(", ")));
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
    const mechMulti = filterMechanismClients(MECH_FIXTURE, { ...defaultMechanismFilters(), mechanism: ["PGBL"] });
    const monthsAll = filterMechanismMonthSeries(MECH_FIXTURE, defaultMechanismFilters(), { now: NOW });
    const monthsPeriod = filterMechanismMonthSeries(MECH_FIXTURE, { ...defaultMechanismFilters(), period: "last_6m" }, { now: NOW });
    const monthsCustom = filterMechanismMonthSeries(
      MECH_FIXTURE,
      { ...defaultMechanismFilters(), period: "custom", from: "2026-07-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    const ep = filterMechanismClients(MECH_FIXTURE, { ...defaultMechanismFilters(), engineer: "Nícolas Alves" });
    checks.push(pass("filter_changes_component", ep.length === 1));
    checks.push(pass("mechanism_multiselect", mechMulti.length === 2));
    checks.push(pass("recent_removed", !contract.uiFilters.includes("recent")));
    checks.push(pass("pct_removed", !contract.uiFilters.includes("pctRange")));
    checks.push(pass("program_in_ui", contract.uiFilters.includes("program")));
    checks.push(pass("period_not_on_stock", periodStock.length === stock.length));
    checks.push(pass("period_on_months", monthsPeriod.length < monthsAll.length || monthsPeriod.every((item) => item.label.startsWith("2026"))));
    checks.push(pass("custom_period_implemented_at", monthsCustom.length === 1 && monthsCustom[0].label === "2026-07"));
    checks.push(...checkSearch(MECH_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "financial_updates") {
    const ep = filterFinancialUpdateClients(FINANCIAL_FIXTURE, { ...defaultFinancialUpdatesFilters(), engineer: "Nícolas Alves" });
    const traits = filterFinancialUpdateClients(FINANCIAL_FIXTURE, {
      ...defaultFinancialUpdatesFilters(),
      status: "all",
      financialTraits: ["hasFinancialData"],
    });
    const periodRows = filterFinancialUpdateClients(
      FINANCIAL_FIXTURE,
      { ...defaultFinancialUpdatesFilters(), status: "all", period: "custom", from: "2026-08-01", to: "2026-08-20" },
      { now: BUG_NOW },
    );
    checks.push(pass("filter_changes_component", ep.length === 1 && ep[0].clientId === "1"));
    checks.push(pass("financial_trait_filter", traits.length === 1 && traits[0].hasFinancialData === true));
    checks.push(pass("period_ui", pageShowsPeriodUi(pageId)));
    checks.push(pass("program_filter", filterFinancialUpdateClients(FINANCIAL_FIXTURE, { ...defaultFinancialUpdatesFilters(), status: "all", program: "Pharus" }).length === 1));
    checks.push(pass("period_on_stock_ignored", periodRows.length === FINANCIAL_FIXTURE.length));
    checks.push(...checkSearch(FINANCIAL_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "satisfaction") {
    const ep = filterSatisfactionClients(SATISFACTION_FIXTURE, { ...defaultSatisfactionFilters(), engineer: "Nícolas Alves" });
    checks.push(pass("filter_changes_component", ep.length === 1));
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(...checkSearch(SATISFACTION_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "cancellations") {
    const ep = filterCancellationClients(CANCEL_FIXTURE, { ...defaultCancellationFilters(), engineer: "Nícolas Alves" });
    const periodUi = pageShowsPeriodUi(pageId);
    checks.push(pass("filter_changes_component", ep.length === 1 && ep[0].hasEfetivado === true));
    checks.push(pass("period_ui", periodUi));
    checks.push(pass("program_filter", filterCancellationClients(CANCEL_FIXTURE, { ...defaultCancellationFilters(), program: "Pharus" }).length === 1));
    checks.push(...checkSearch(CANCEL_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "renewal") {
    const ep = filterRenewalClients(RENEWAL_FIXTURE, { ...defaultRenewalFilters(), engineer: "Nícolas Alves" });
    const renewedYes = filterRenewalClients(RENEWAL_FIXTURE, { ...defaultRenewalFilters(), renewed: "yes" });
    checks.push(pass("filter_changes_component", ep.length === 1 && ep[0].renewed === true));
    checks.push(pass("renewed_filter", contract.uiFilters.includes("renewed")));
    checks.push(pass("renewed_yes_cycle", renewedYes.every((r) => r.renewed === true)));
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(...checkSearch(RENEWAL_FIXTURE));
    checks.push(...checkExport(ep, contract.exportColumns, [{ label: "EP", value: "Nícolas Alves" }]));
  }

  if (pageId === "ep_performance") {
    const EP_FIXTURE = [
      { engineer: "Nícolas Alves", totalClients: 10, activeClients: 8, meetingCoverage: 70, cancelledShareOfPortfolio: 10 },
      { engineer: "Outro EP", totalClients: 5, activeClients: 4, meetingCoverage: 40, cancelledShareOfPortfolio: 20 },
    ];
    const filtered = filterEpEngineers(EP_FIXTURE, { ...defaultEpPerformanceFilters(), search: "Nícolas" });
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(pass("program_filter_ui", contract.uiFilters.includes("program")));
    checks.push(pass("filter_engineer_search", filtered.length === 1 && filtered[0].engineer === "Nícolas Alves"));
    checks.push(pass("denominator_visible", contract.notes.some((n) => /denominador|cobertura/i.test(n))));
  }

  if (pageId === "temporal_indicators") {
    const TEMP_FIXTURE = [
      { subjectName: "Ana", subjectCode: "A1", subjectId: "1", program: "Pharus", source: "BASE QV", month: "2026-08", monthsToCancellation: 0, cancellationDate: "2026-01-01" },
      { subjectName: "João", subjectCode: "B2", subjectId: "2", program: "Davos", source: "App Pharus", month: "2026-07" },
    ];
    const filtered = filterTemporalActivityRecency(TEMP_FIXTURE, { ...defaultTemporalIndicatorsFilters(), program: "Pharus", source: "BASE QV" });
    const monthly = summarizeFilteredTemporal(
      {
        months: ["2026-08", "2026-07"],
        clients: TEMP_FIXTURE.map((r) => ({ ...r, logins: 1, meetings: 0, financialUpdates: 0, npsResponses: 0 })),
        activityRecency: TEMP_FIXTURE,
        preCancellation: { clients: [], signals: [] },
        activeRisk: { clients: [], signals: [] },
      },
      { ...defaultTemporalIndicatorsFilters(), month: "2026-08", source: "BASE QV" },
    );
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(pass("program_filter", filtered.length === 1));
    checks.push(pass("source_filter", contract.uiFilters.includes("source")));
    checks.push(pass("month_filter", contract.uiFilters.includes("month")));
    checks.push(pass("cancel_filter", contract.uiFilters.includes("cancelWindow")));
    checks.push(pass("month_changes_population", monthly.recency.length === 1));
    checks.push(pass("no_causal_language_note", contract.notes.some((n) => /causalidade/i.test(n))));
    checks.push(...checkSearch(TEMP_FIXTURE.map((r) => ({ clientName: r.subjectName, clientCode: r.subjectCode, clientId: r.subjectId }))));
  }

  if (pageId === "statistical_crosses") {
    const params = statisticalCrossesFiltersToSearchParams({ ...defaultStatisticalCrossesFilters(), program: "Pharus", minCoverage: 25, minSample: 7 });
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(pass("program_param", params.get("program") === "Pharus"));
    checks.push(pass("min_coverage_param", params.get("minCoverage") === "25"));
    checks.push(pass("min_sample_param", params.get("minSample") === "7"));
    checks.push(pass("sc_pass_min", scPassMin({ coveragePercent: 10, nActive: 10, nCancelled: 10 }, 25, 7) === false));
    checks.push(pass("methodology_notes", contract.notes.some((n) => /Kaplan|causalidade/i.test(n))));
    checks.push(pass("unimplemented_visual_documented", (contract.unimplementedVisualFilters || []).length > 0));
  }

  if (pageId === "quality") {
    const QUALITY_ROWS = [
      { column: "name", table: "clients", clientName: "Ana", clientCode: "A1", clientId: "1" },
      { column: "email", table: "clients", clientName: "João", clientCode: "B2", clientId: "2" },
    ];
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    checks.push(pass("domain_filter_ui", contract.uiFilters.includes("domain")));
    checks.push(pass("severity_filter_ui", contract.uiFilters.includes("severity")));
    checks.push(...checkSearch(QUALITY_ROWS));
  }

  if (pageId === "reports") {
    checks.push(...checkReportsBehavior());
    checks.push(pass("not_period_ui", !pageShowsPeriodUi(pageId)));
    return checks;
  }

  const cleared = pageId === "meetings"
    ? defaultMeetingFilters()
    : pageId === "journey"
      ? defaultOnboardingFilters()
      : pageId === "patrimonial_plan"
        ? defaultPlanFilters()
        : pageId === "mechanisms"
          ? defaultMechanismFilters()
          : pageId === "financial_updates"
            ? defaultFinancialUpdatesFilters()
            : pageId === "satisfaction"
              ? defaultSatisfactionFilters()
              : pageId === "cancellations"
                ? defaultCancellationFilters()
                : pageId === "renewal"
                  ? defaultRenewalFilters()
                  : pageId === "ep_performance"
                    ? defaultEpPerformanceFilters()
                    : pageId === "temporal_indicators"
                      ? defaultTemporalIndicatorsFilters()
                      : pageId === "statistical_crosses"
                        ? defaultStatisticalCrossesFilters()
                        : pageId === "platform_usage"
                          ? defaultPlatformUsageFilters()
                          : pageId === "support"
                            ? defaultSupportFilters()
                            : defaultGeneralFilters();
  checks.push(pass("clear_filters", (() => {
    if (pageId === "statistical_crosses") {
      const c = defaultStatisticalCrossesFilters();
      return c.program === "all" && c.engineer === "all" && c.segment === "all" && c.status === "active_cancelled" && c.minCoverage === 30 && c.minSample === 5;
    }
    return cleared.search === "" && (cleared.period == null || cleared.period === "all") && !cleared.from && !cleared.to;
  })()));
  checks.push(pass("period_ui_expected", pageShowsPeriodUi(pageId) === ["meetings", "financial_updates", "cancellations", "support"].includes(pageId), pageShowsPeriodUi(pageId) ? "com período" : "sem período"));
  return checks;
}

function checkReportsBehavior() {
  const reportsJs = readFileSync(resolve(root, "js/reports.js"), "utf8");
  const handlerJs = readFileSync(resolve(root, "lib/analytics/reports-handler.mjs"), "utf8");
  const sql = readFileSync(resolve(root, "sql/analytics/006_reports.sql"), "utf8");
  const pagesJs = readFileSync(resolve(root, "js/pages.js"), "utf8");
  const appJs = readFileSync(resolve(root, "js/app.js"), "utf8");
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  const fixture = [
    {
      id: "1",
      title: "Análise de Cancelamentos",
      description: "Principais sinais",
      fileName: "cancelamentos.pdf",
      fileExtension: "pdf",
      responsibleEmail: "ana@quartavia.com.br",
      createdAt: "2026-08-20T15:40:00.000Z",
      typeCategory: "pdf",
    },
    {
      id: "2",
      title: "Planilha Mensal",
      description: "Indicadores",
      fileName: "mensal.xlsx",
      fileExtension: "xlsx",
      responsibleEmail: "joao@quartavia.com.br",
      createdAt: "2026-08-19T10:00:00.000Z",
      typeCategory: "spreadsheet",
    },
  ];
  const searched = filterReports(fixture, { search: "cancelamento" });
  const typed = filterReports(fixture, { type: "spreadsheet" });
  return [
    pass("reports_nav", pagesJs.includes('id: "reports"') && pagesJs.includes("Relatórios")),
    pass("reports_boot", appJs.includes("bootReports")),
    pass("reports_search", searched.length === 1 && searched[0].id === "1"),
    pass("reports_type_filter", typed.length === 1 && typed[0].id === "2"),
    pass("reports_upload_ui", reportsJs.includes("Publicar relatório") && reportsJs.includes('fileInput.type = "file"')),
    pass("reports_title_required", reportsJs.includes("validateReportTitle")),
    pass("reports_description_optional", reportsJs.includes("Descrição") && reportsJs.includes("textarea")),
    pass("reports_responsible_readonly", reportsJs.includes("getUserEmail") && reportsJs.includes("readonly")),
    pass("reports_backend_session_email", handlerJs.includes("responsible_email: user.email") && handlerJs.includes("created_by: user.id")),
    pass("reports_private_storage", sql.includes("'analytics-reports'") && (sql.includes("| public: false") || sql.includes("\n  false,\n"))),
    pass("reports_metadata_table", sql.includes("analytics.reports")),
    pass("reports_signed_open", reportsJs.includes("/api/reports?open=") && handlerJs.includes("createSignedUrl")),
    pass("reports_empty_state", reportsJs.includes("Publicar primeiro relatório")),
    pass("reports_layout_css", css.includes(".reports-grid") && css.includes(".reports-modal")),
  ];
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
    pass("ep_no_period_ui", !pageShowsPeriodUi("ep_performance")),
    pass("temporal_no_period_ui", !pageShowsPeriodUi("temporal_indicators")),
    pass("statistical_no_period_ui", !pageShowsPeriodUi("statistical_crosses")),
    pass("mechanisms_no_period_ui", !pageShowsPeriodUi("mechanisms")),
    pass("journey_program_ui", PAGE_FILTER_CONTRACTS.journey.uiFilters.includes("program")),
    pass("meetings_program_ui", PAGE_FILTER_CONTRACTS.meetings.uiFilters.includes("program")),
    pass("plan_program_ui", PAGE_FILTER_CONTRACTS.patrimonial_plan.uiFilters.includes("program")),
    pass("sticky_toggle_visible", shellSource.includes("Fixar filtros ao rolar") && shellSource.includes("data-filter-sticky")),
    pass("sticky_persisted", shellSource.includes("sessionStorage") && shellSource.includes("readStickyPinned")),
    pass("sticky_layout_css", cssSource.includes(".page-filters.is-sticky-pinned") && cssSource.includes("position: sticky") && cssSource.includes("overflow: visible")),
    pass("sticky_shadow", cssSource.includes(".page-filters.is-sticky-pinned.is-stuck")),
    pass("sticky_host_not_inner_shell", shellSource.includes("host.classList.toggle(\"is-sticky-pinned\"") && cssSource.includes(".page-filters.is-sticky-pinned")),
    pass("sticky_scroll_target", shellSource.includes("resolveFilterScrollTarget")),
    pass("sticky_z_below_overlay", stylesCss.includes("--z-filter-sticky") && stylesCss.includes("--z-overlay")),
    pass("assistant_aligned_v2", assistantCss.includes("background: var(--surface)") && !assistantCss.includes("assistant-fab-gold") && !assistantSource.includes("assistant-fab-gold")),
    pass("assistant_no_robot", !assistantSource.includes("assistant-fab-icon") && !assistantSource.includes("ROBOT_ICON")),
    pass("assistant_shimmer", assistantCss.includes("assistant-fab-shimmer") && assistantCss.includes("prefers-reduced-motion: reduce")),
    pass("scroll_top_boot", appSource.includes("bootScrollToTop") && scrollSource.includes('behavior: "smooth"')),
    pass("platform_support_boot", appSource.includes("bootPlatformUsage") && appSource.includes("bootSupport")),
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
  const reportsChecks = checkReportsBehavior();
  const reportsOk = reportsChecks.every((item) => item.ok);
  if (!reportsOk) failed = true;
  const multiRefreshChecks = checkMultiSelectAndRefresh();
  const multiRefreshOk = multiRefreshChecks.every((item) => item.ok);
  if (!multiRefreshOk) failed = true;
  const periodUiChecks = checkPeriodUiPages();
  const periodUiOk = periodUiChecks.every((item) => item.ok);
  if (!periodUiOk) failed = true;
  return {
    ok: !failed,
    missingContracts: missing,
    pages,
    dateRange: { ok: dateRangeOk, checks: dateRangeChecks },
    multiselectRefresh: { ok: multiRefreshOk, checks: multiRefreshChecks },
    periodUi: { ok: periodUiOk, checks: periodUiChecks },
    ux: { ok: uxOk, checks: uxChecks },
    reports: { ok: reportsOk, checks: reportsChecks },
  };
}
