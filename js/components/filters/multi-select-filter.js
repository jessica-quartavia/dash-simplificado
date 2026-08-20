/**
 * Dropdown multiselect com checkbox — OR dentro do filtro, AND entre filtros.
 */
import { escapeHtml } from "../../general-charts.mjs";
import {
  normalizeMultiSelectFilter,
  parseMultiSelectValue,
  serializeMultiSelectValue,
  summarizeMultiSelectLabel,
} from "../../../lib/analytics/filters/multiselect.mjs";
import {
  ensureOverlayRoot,
  mountPopoverPortal,
  unmountPopoverPortal,
} from "../overlay-root.js";

function hiddenInput(id, value) {
  return `<input type="hidden" id="${escapeHtml(id)}" value="${escapeHtml(value || "")}" />`;
}

export function readMultiSelectFieldValue(field) {
  const raw = document.getElementById(field.id)?.value || "";
  return parseMultiSelectValue(raw);
}

export function writeMultiSelectFieldValue(field, values) {
  const el = document.getElementById(field.id);
  const normalized = normalizeMultiSelectFilter(values);
  if (el) el.value = serializeMultiSelectValue(normalized);
  return normalized;
}

export function renderMultiSelectFilter({
  field,
  filters = {},
  label = field?.label || "Filtro",
} = {}) {
  const options = field.options || [];
  const selected = normalizeMultiSelectFilter(filters[field.key]);
  const summary = summarizeMultiSelectLabel(options, selected, {
    allLabel: field.allLabel || "Todos",
    maxChars: field.summaryMaxChars || 28,
  });

  const items = options
    .map((option) => {
      const value = option.value ?? option;
      const optionLabel = option.label ?? option;
      const checked = selected.includes(String(value));
      return `
        <label class="msf-option">
          <input type="checkbox" value="${escapeHtml(value)}" data-msf-option ${checked ? " checked" : ""} />
          <span>${escapeHtml(optionLabel)}</span>
        </label>
      `;
    })
    .join("");

  const showAll = field.showAll !== false;
  const allActive = selected.length === 0;

  return `
    <div class="multi-select-filter" data-msf-root data-msf-field="${escapeHtml(field.key)}">
      <span class="msf-label">${escapeHtml(label)}</span>
      <button
        type="button"
        class="msf-trigger"
        data-msf-trigger
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-label="${escapeHtml(label)}"
      >
        <span class="msf-summary" data-msf-summary title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
        <span class="msf-chevron" aria-hidden="true">▾</span>
      </button>
      ${hiddenInput(field.id, serializeMultiSelectValue(selected))}
      <div class="msf-popover" data-msf-popover data-drp-popover hidden role="listbox" aria-label="${escapeHtml(label)}">
        ${showAll ? `<button type="button" class="msf-all${allActive ? " is-active" : ""}" data-msf-all>Todos</button>` : ""}
        <div class="msf-options">${items}</div>
      </div>
    </div>
  `;
}

function updateSummary(root, field, filters) {
  const summaryEl = root.querySelector("[data-msf-summary]");
  if (!summaryEl) return;
  const selected = readMultiSelectFieldValue(field);
  const text = summarizeMultiSelectLabel(field.options || [], selected, {
    allLabel: field.allLabel || "Todos",
    maxChars: field.summaryMaxChars || 28,
  });
  summaryEl.textContent = text;
  summaryEl.title = text;
  const allBtn = root.querySelector("[data-msf-all]");
  allBtn?.classList.toggle("is-active", selected.length === 0);
}

function closePopover(root, state) {
  if (!state.open) return;
  state.open = false;
  const trigger = root.querySelector("[data-msf-trigger]");
  const popover = root.querySelector("[data-msf-popover]");
  trigger?.setAttribute("aria-expanded", "false");
  unmountPopoverPortal({
    overlayRoot: state.overlayRoot,
    backdrop: state.backdrop,
    popover,
  });
  state.overlayRoot = null;
  state.backdrop = null;
  document.removeEventListener("keydown", state.onKeyDown);
}

function openPopover(root, field, state) {
  const trigger = root.querySelector("[data-msf-trigger]");
  const popover = root.querySelector("[data-msf-popover]");
  if (!trigger || !popover) return;
  state.open = true;
  trigger.setAttribute("aria-expanded", "true");
  const mounted = mountPopoverPortal({
    anchor: trigger,
    popover,
    overlayRoot: ensureOverlayRoot(),
    onDismiss: () => closePopover(root, state),
  });
  state.overlayRoot = mounted.overlayRoot;
  state.backdrop = mounted.backdrop;
  state.onKeyDown = (event) => {
    if (event.key === "Escape") closePopover(root, state);
  };
  document.addEventListener("keydown", state.onKeyDown);
}

export function bindMultiSelectFilter({
  host,
  field,
  filters = {},
  onChange,
} = {}) {
  const root = host?.querySelector?.(`[data-msf-field="${field.key}"]`)
    || host?.querySelector?.("[data-msf-root]");
  if (!root) return () => {};

  const state = { open: false, overlayRoot: null, backdrop: null, onKeyDown: null };
  updateSummary(root, field, filters);

  const trigger = root.querySelector("[data-msf-trigger]");
  const popover = root.querySelector("[data-msf-popover]");
  const allBtn = root.querySelector("[data-msf-all]");

  const applySelection = (nextValues) => {
    writeMultiSelectFieldValue(field, nextValues);
    updateSummary(root, field, filters);
    closePopover(root, state);
    onChange?.(nextValues);
  };

  const onTriggerClick = (event) => {
    event.preventDefault();
    if (state.open) closePopover(root, state);
    else openPopover(root, field, state);
  };

  const onAllClick = () => applySelection([]);

  const onOptionChange = (event) => {
    const checkbox = event.target;
    if (!checkbox?.matches?.("[data-msf-option]")) return;
    const current = new Set(readMultiSelectFieldValue(field));
    const value = checkbox.value;
    if (checkbox.checked) current.add(value);
    else current.delete(value);
    applySelection([...current]);
  };

  trigger?.addEventListener("click", onTriggerClick);
  allBtn?.addEventListener("click", onAllClick);
  popover?.addEventListener("change", onOptionChange);

  return () => {
    closePopover(root, state);
    trigger?.removeEventListener("click", onTriggerClick);
    allBtn?.removeEventListener("click", onAllClick);
    popover?.removeEventListener("change", onOptionChange);
  };
}

export function fillMultiSelectOptions(host, field, options, currentValues) {
  const root = host?.querySelector?.(`[data-msf-field="${field.key}"]`);
  if (!root) return;
  field.options = options || [];
  const keep = normalizeMultiSelectFilter(currentValues ?? readMultiSelectFieldValue(field));
  const allowed = new Set((options || []).map((item) => String(item.value ?? item)));
  const next = keep.filter((value) => allowed.has(value));
  writeMultiSelectFieldValue(field, next);
  const optionsHost = root.querySelector(".msf-options");
  if (optionsHost) {
    optionsHost.innerHTML = (options || [])
      .map((option) => {
        const value = option.value ?? option;
        const optionLabel = option.label ?? option;
        const checked = next.includes(String(value));
        return `
          <label class="msf-option">
            <input type="checkbox" value="${escapeHtml(value)}" data-msf-option${checked ? " checked" : ""} />
            <span>${escapeHtml(optionLabel)}</span>
          </label>
        `;
      })
      .join("");
  }
  updateSummary(root, field, {});
}
