/**
 * Date Range Picker global — popover com calendário e presets.
 */
import { escapeHtml } from "../../general-charts.mjs";
import {
  DATE_RANGE_PRESET_OPTIONS,
  applyPeriodPreset,
  formatPeriodFieldLabel,
  isFutureIso,
  isRangeComplete,
  isRangeEdge,
  monthMatrix,
  monthTitle,
  normalizeCustomRange,
  normalizePeriodMode,
  normalizeRangeSelection,
  rangeIncludes,
  sanitizePeriodFilters,
  shiftMonth,
  todayIso,
  canNavigateToMonth,
} from "../../../lib/analytics/filters/period.mjs";
import {
  ensureOverlayRoot,
  mountPopoverPortal,
  positionAnchoredPopover,
  unmountPopoverPortal,
} from "../overlay-root.js";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Máquina de estados da seleção start/end — exportada para testes. */
export function nextDraftAfterDayClick(draft, iso, now = new Date()) {
  if (!iso || isFutureIso(iso, now)) {
    return { draft, changed: false };
  }

  const next = {
    period: "custom",
    start: draft.start || "",
    end: draft.end || "",
    hover: "",
  };

  const pickingEnd = Boolean(next.start && !next.end);
  if (!pickingEnd) {
    next.start = iso;
    next.end = "";
    return { draft: next, changed: true };
  }

  if (next.start === iso) {
    next.end = iso;
    return { draft: next, changed: true };
  }

  const normalized = normalizeRangeSelection(next.start, iso, now);
  if (normalized.error) return { draft, changed: false };
  next.start = normalized.start || next.start;
  next.end = normalized.end || "";
  return { draft: next, changed: true };
}

function dayHighlightState(iso, draft) {
  const start = draft.start;
  const end = draft.end;
  const hoverIso = draft.hover;
  const pendingEnd = Boolean(start && !end);
  const edge = isRangeEdge(iso, start, end) || (pendingEnd && iso === start);
  const selected =
    edge
    || (pendingEnd && hoverIso && rangeIncludes(iso, start, hoverIso))
    || (start && end && rangeIncludes(iso, start, end));
  const hoverEnd = Boolean(pendingEnd && hoverIso && iso === hoverIso);

  return { selected, edge, hoverEnd };
}

function hiddenInput(id, value) {
  return `<input type="hidden" id="${escapeHtml(id)}" value="${escapeHtml(value || "")}" />`;
}

export function readPeriodFieldValues(field) {
  return {
    period: document.getElementById(field.id)?.value || "all",
    from: document.getElementById(field.fromId)?.value || "",
    to: document.getElementById(field.toId)?.value || "",
  };
}

export function writePeriodFieldValues(field, values) {
  const sanitized = sanitizePeriodFilters(values);
  const periodEl = document.getElementById(field.id);
  const fromEl = document.getElementById(field.fromId);
  const toEl = document.getElementById(field.toId);
  if (periodEl) periodEl.value = sanitized.period;
  if (fromEl) fromEl.value = sanitized.from;
  if (toEl) toEl.value = sanitized.to;
  return sanitized;
}

export function renderDateRangePicker({ field, filters = {}, label = "Período" } = {}) {
  const sanitized = sanitizePeriodFilters(filters);
  const display = formatPeriodFieldLabel(sanitized);
  const presetButtons = DATE_RANGE_PRESET_OPTIONS.map(
    (item) =>
      `<button type="button" class="drp-preset${sanitized.period === item.value ? " is-active" : ""}" data-drp-preset="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`,
  ).join("");

  return `
    <div class="date-range-picker" data-drp-root>
      <span class="drp-label">${escapeHtml(label)}</span>
      <button
        type="button"
        class="drp-trigger"
        data-drp-trigger
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label="Selecionar período"
      >
        <span class="drp-value" data-drp-value>${escapeHtml(display)}</span>
        <span class="drp-icon" aria-hidden="true">◷</span>
      </button>
      ${hiddenInput(field.id, sanitized.period)}
      ${hiddenInput(field.fromId, sanitized.from)}
      ${hiddenInput(field.toId, sanitized.to)}
      <div class="drp-popover" data-drp-popover hidden role="dialog" aria-label="Selecionar intervalo de datas">
        <div class="drp-presets" role="list">${presetButtons}</div>
        <div class="drp-calendar" data-drp-calendar></div>
        <div class="drp-actions">
          <button type="button" class="btn btn-secondary" data-drp-clear>Limpar</button>
          <button type="button" class="btn btn-secondary" data-drp-apply disabled>Aplicar</button>
        </div>
      </div>
    </div>
  `;
}

function renderCalendarGrid({ year, month, draft, hoverIso, now }) {
  const cells = monthMatrix(year, month, now);
  const start = draft.start;
  const end = draft.end;
  const pendingEnd = start && !end;

  const dayButtons = cells
    .map((cell) => {
      if (!cell.inMonth) {
        return `<span class="drp-day drp-day-empty" aria-hidden="true"></span>`;
      }
      const edge = isRangeEdge(cell.iso, start, end) || (pendingEnd && cell.iso === start);
      const { selected, hoverEnd } = dayHighlightState(cell.iso, { start, end, hover: hoverIso });
      const classes = [
        "drp-day",
        cell.isToday ? "is-today" : "",
        cell.disabled ? "is-disabled" : "",
        selected ? "is-selected" : "",
        edge ? "is-edge" : "",
        hoverEnd ? "is-hover-end" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button
        type="button"
        class="${classes}"
        data-drp-day="${escapeHtml(cell.iso)}"
        ${cell.disabled ? "disabled aria-disabled=true" : ""}
        aria-selected="${selected ? "true" : "false"}"
        aria-label="${escapeHtml(cell.iso)}"
      >${cell.day}</button>`;
    })
    .join("");

  const next = shiftMonth(year, month, 1);
  const prev = shiftMonth(year, month, -1);
  const canNext = canNavigateToMonth(next.year, next.month, now);

  return `
    <div class="drp-calendar-head">
      <button type="button" class="drp-nav" data-drp-nav="-1" aria-label="Mês anterior">‹</button>
      <div class="drp-month-label">${escapeHtml(monthTitle(year, month))}</div>
      <button type="button" class="drp-nav" data-drp-nav="1" aria-label="Próximo mês" ${canNext ? "" : "disabled"}>›</button>
    </div>
    <div class="drp-weekdays">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="drp-grid" role="grid" aria-label="Calendário">${dayButtons}</div>
  `;
}

export function bindDateRangePicker({
  host,
  field,
  filters = {},
  onApply,
  now = new Date(),
} = {}) {
  if (!host || !field) return () => {};

  const root = host.querySelector("[data-drp-root]");
  if (!root) return () => {};

  const trigger = root.querySelector("[data-drp-trigger]");
  const popover = root.querySelector("[data-drp-popover]");
  const calendarHost = root.querySelector("[data-drp-calendar]");
  const valueNode = root.querySelector("[data-drp-value]");
  const applyBtn = root.querySelector("[data-drp-apply]");
  const clearBtn = root.querySelector("[data-drp-clear]");

  const domValues = readPeriodFieldValues(field);
  const hasDomPeriod = domValues.period !== "all" || domValues.from || domValues.to;
  let applied = sanitizePeriodFilters(hasDomPeriod ? domValues : filters, now);
  let draft = {
    period: applied.period,
    start: applied.from || "",
    end: applied.to || "",
    hover: "",
  };
  let view = (() => {
    const anchor = applied.from || applied.to || todayIso(now);
    const year = Number(anchor.slice(0, 4));
    const month = Number(anchor.slice(5, 7));
    return { year, month: Number.isFinite(month) ? month : 1 };
  })();

  const cleanups = [];
  let calendarCleanups = [];
  let portalBackdrop = null;
  let overlayRoot = null;
  let portalOpen = false;

  ensureOverlayRoot();
  if (popover && popover.parentNode === root) {
    overlayRoot = ensureOverlayRoot();
    overlayRoot.appendChild(popover);
    popover.hidden = true;
  }

  function clearCalendarCleanups() {
    calendarCleanups.forEach((fn) => fn());
    calendarCleanups = [];
  }

  function syncHidden(values) {
    applied = sanitizePeriodFilters(values, now);
    writePeriodFieldValues(field, applied);
    if (valueNode) valueNode.textContent = formatPeriodFieldLabel(applied, now);
    popover?.querySelectorAll("[data-drp-preset]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.drpPreset === applied.period);
    });
  }

  function draftToFilters() {
    if (normalizePeriodMode(draft.period) === "all") {
      return { period: "all", from: "", to: "" };
    }
    if (normalizePeriodMode(draft.period) === "today") {
      return applyPeriodPreset("today", now);
    }
    if (normalizePeriodMode(draft.period) !== "custom") {
      return applyPeriodPreset(draft.period, now);
    }
    const normalized = normalizeCustomRange(draft.start, draft.end, now);
    if (!normalized.ok) return { period: "all", from: "", to: "" };
    return { period: "custom", from: normalized.from, to: normalized.to };
  }

  function updateApplyState() {
    const mode = normalizePeriodMode(draft.period);
    const enabled =
      mode === "all"
      || mode === "today"
      || (mode !== "custom" && mode !== "all")
      || isRangeComplete(draft.start, draft.end);
    if (applyBtn) applyBtn.disabled = !enabled;
  }

  function updateDayHighlights() {
    if (!calendarHost) return;
    calendarHost.querySelectorAll("[data-drp-day]").forEach((button) => {
      const iso = button.dataset.drpDay;
      if (!iso) return;
      const { selected, edge, hoverEnd } = dayHighlightState(iso, draft);
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-edge", edge);
      button.classList.toggle("is-hover-end", hoverEnd);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  function paintCalendar() {
    if (!calendarHost) return;
    clearCalendarCleanups();
    calendarHost.innerHTML = renderCalendarGrid({
      year: view.year,
      month: view.month,
      draft,
      hoverIso: draft.hover,
      now,
    });
    bindCalendarEvents();
  }

  function bindPortalListeners() {
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
  }

  function unbindPortalListeners() {
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
  }

  function onViewportChange() {
    if (!portalOpen || popover.hidden) return;
    positionAnchoredPopover({ anchor: trigger, popover });
  }

  function openPopover() {
    draft = {
      period: applied.period,
      start: applied.from || "",
      end: applied.to || "",
      hover: "",
    };
    const anchor = applied.from || applied.to || todayIso(now);
    view.year = Number(anchor.slice(0, 4));
    view.month = Number(anchor.slice(5, 7));
    trigger?.setAttribute("aria-expanded", "true");
    paintCalendar();
    updateApplyState();
    syncPresetActiveState();

    const mounted = mountPopoverPortal({
      anchor: trigger,
      popover,
      overlayRoot: ensureOverlayRoot(),
      onDismiss: () => closePopover(true),
    });
    portalBackdrop = mounted.backdrop;
    overlayRoot = mounted.overlayRoot;
    portalOpen = true;
    bindPortalListeners();
    document.addEventListener("keydown", onEscape, true);
  }

  function closePopover(restoreDraft = true) {
    if (restoreDraft) {
      draft = {
        period: applied.period,
        start: applied.from || "",
        end: applied.to || "",
        hover: "",
      };
    }
    portalOpen = false;
    unbindPortalListeners();
    unmountPopoverPortal({ overlayRoot, backdrop: portalBackdrop, popover });
    portalBackdrop = null;
    trigger?.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onEscape, true);
  }

  function onEscape(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover(true);
    }
  }

  function syncPresetActiveState() {
    popover?.querySelectorAll("[data-drp-preset]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.drpPreset === draft.period);
    });
  }

  function selectDay(iso) {
    const result = nextDraftAfterDayClick(draft, iso, now);
    if (!result.changed) return;
    draft = result.draft;
    updateDayHighlights();
    updateApplyState();
    popover?.querySelectorAll("[data-drp-preset]").forEach((button) => button.classList.remove("is-active"));
  }

  function bindCalendarEvents() {
    calendarHost.querySelectorAll("[data-drp-day]").forEach((button) => {
      if (button.disabled) return;

      const handler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectDay(button.dataset.drpDay);
      };
      button.addEventListener("mousedown", handler);
      calendarCleanups.push(() => button.removeEventListener("mousedown", handler));

      const enter = () => {
        if (!draft.start || draft.end) return;
        const hoverIso = button.dataset.drpDay || "";
        if (draft.hover === hoverIso) return;
        draft.hover = hoverIso;
        updateDayHighlights();
      };
      button.addEventListener("mouseenter", enter);
      calendarCleanups.push(() => button.removeEventListener("mouseenter", enter));
    });

    const clearHover = () => {
      if (!draft.hover) return;
      draft.hover = "";
      updateDayHighlights();
    };
    calendarHost.addEventListener("mouseleave", clearHover);
    calendarCleanups.push(() => calendarHost.removeEventListener("mouseleave", clearHover));

    calendarHost.querySelectorAll("[data-drp-nav]").forEach((button) => {
      const handler = () => {
        const delta = Number(button.dataset.drpNav);
        const next = shiftMonth(view.year, view.month, delta);
        if (!canNavigateToMonth(next.year, next.month, now)) return;
        view.year = next.year;
        view.month = next.month;
        paintCalendar();
      };
      button.addEventListener("click", handler);
      calendarCleanups.push(() => button.removeEventListener("click", handler));
    });
  }

  const onTrigger = (event) => {
    event.stopPropagation();
    if (!portalOpen) openPopover();
    else closePopover(true);
  };
  trigger?.addEventListener("click", onTrigger);
  cleanups.push(() => trigger?.removeEventListener("click", onTrigger));

  const onPopoverClick = (event) => event.stopPropagation();
  popover?.addEventListener("click", onPopoverClick);
  cleanups.push(() => popover?.removeEventListener("click", onPopoverClick));

  popover?.querySelectorAll("[data-drp-preset]").forEach((button) => {
    const handler = () => {
      const preset = button.dataset.drpPreset || "all";
      const next = applyPeriodPreset(preset, now);
      draft.period = next.period;
      draft.start = next.from || "";
      draft.end = next.to || "";
      draft.hover = "";
      popover.querySelectorAll("[data-drp-preset]").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      if (draft.start) {
        view.year = Number(draft.start.slice(0, 4));
        view.month = Number(draft.start.slice(5, 7));
      }
      paintCalendar();
      updateApplyState();
    };
    button.addEventListener("click", handler);
    cleanups.push(() => button.removeEventListener("click", handler));
  });

  const onClear = () => {
    draft = { period: "all", start: "", end: "", hover: "" };
    paintCalendar();
    updateApplyState();
    popover?.querySelectorAll("[data-drp-preset]").forEach((item) => item.classList.remove("is-active"));
    popover?.querySelector('[data-drp-preset="all"]')?.classList.add("is-active");
  };
  clearBtn?.addEventListener("click", onClear);
  cleanups.push(() => clearBtn?.removeEventListener("click", onClear));

  const onApplyClick = () => {
    const next = draftToFilters();
    syncHidden(next);
    closePopover(false);
    onApply?.(next);
  };
  applyBtn?.addEventListener("click", onApplyClick);
  cleanups.push(() => applyBtn?.removeEventListener("click", onApplyClick));

  syncHidden(applied);

  return () => {
    closePopover(true);
    popover?.remove();
    cleanups.forEach((fn) => fn());
  };
}
