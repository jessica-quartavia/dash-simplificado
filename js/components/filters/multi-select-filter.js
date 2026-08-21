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
  eventPathIncludes,
  mountPopoverPortal,
  positionAnchoredPopover,
  unmountPopoverPortal,
} from "../overlay-root.js";
import {
  closeOpenDropdown,
  registerOpenDropdown,
  unregisterOpenDropdown,
} from "../dropdown-coordinator.js";

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

function updateSummary(root, field) {
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

/** Exportado para testes — clique dentro do trigger/popover/backdrop não fecha. */
export function isMultiselectInsideEvent(event, { root, trigger, popover, backdrop } = {}) {
  return eventPathIncludes(event, [root, trigger, popover, backdrop]);
}

function closePopover(root, field, state, { focusTrigger = false } = {}) {
  if (!state.open) return;
  state.open = false;
  unregisterOpenDropdown(state.controller);
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
  document.removeEventListener("pointerdown", state.onPointerDown, true);
  document.removeEventListener("keydown", state.onKeyDown, true);
  window.removeEventListener("scroll", state.onViewportChange, true);
  window.removeEventListener("resize", state.onViewportChange);
  if (focusTrigger) trigger?.focus?.();
}

function openPopover(root, field, state) {
  const trigger = root.querySelector("[data-msf-trigger]");
  const popover = root.querySelector("[data-msf-popover]");
  if (!trigger || !popover) return;

  closeOpenDropdown();
  state.open = true;
  trigger.setAttribute("aria-expanded", "true");
  const mounted = mountPopoverPortal({
    anchor: trigger,
    popover,
    overlayRoot: ensureOverlayRoot(),
    onDismiss: () => closePopover(root, field, state),
  });
  state.overlayRoot = mounted.overlayRoot;
  state.backdrop = mounted.backdrop;

  state.onPointerDown = (event) => {
    if (!state.open) return;
    if (isMultiselectInsideEvent(event, { root, trigger, popover, backdrop: state.backdrop })) return;
    closePopover(root, field, state);
  };
  state.onKeyDown = (event) => {
    if (event.key !== "Escape" || !state.open) return;
    event.preventDefault();
    event.stopPropagation();
    closePopover(root, field, state, { focusTrigger: true });
  };
  state.onViewportChange = () => {
    if (!state.open || popover.hidden) return;
    positionAnchoredPopover({ anchor: trigger, popover });
  };

  document.addEventListener("pointerdown", state.onPointerDown, true);
  document.addEventListener("keydown", state.onKeyDown, true);
  window.addEventListener("scroll", state.onViewportChange, true);
  window.addEventListener("resize", state.onViewportChange);
  registerOpenDropdown(state.controller);
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

  const state = {
    open: false,
    overlayRoot: null,
    backdrop: null,
    onPointerDown: null,
    onKeyDown: null,
    onViewportChange: null,
    controller: {
      close: () => closePopover(root, field, state),
    },
  };

  ensureOverlayRoot();
  const popover = root.querySelector("[data-msf-popover]");
  if (popover && popover.parentNode === root) {
    ensureOverlayRoot().appendChild(popover);
    popover.hidden = true;
  }

  updateSummary(root, field);

  const trigger = root.querySelector("[data-msf-trigger]");
  const allBtn = root.querySelector("[data-msf-all]");

  const applySelection = (nextValues, { notify = true } = {}) => {
    writeMultiSelectFieldValue(field, nextValues);
    updateSummary(root, field);
    if (notify) onChange?.(nextValues);
  };

  const onTriggerClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.open) closePopover(root, field, state);
    else openPopover(root, field, state);
  };

  const onAllClick = (event) => {
    event.preventDefault();
    applySelection([]);
  };

  const onOptionChange = (event) => {
    const checkbox = event.target;
    if (!checkbox?.matches?.("[data-msf-option]")) return;
    event.stopPropagation();
    const current = new Set(readMultiSelectFieldValue(field));
    const value = checkbox.value;
    if (checkbox.checked) current.add(value);
    else current.delete(value);
    applySelection([...current]);
  };

  const onPopoverPointerDown = (event) => {
    event.stopPropagation();
  };

  trigger?.addEventListener("click", onTriggerClick);
  allBtn?.addEventListener("click", onAllClick);
  popover?.addEventListener("change", onOptionChange);
  popover?.addEventListener("pointerdown", onPopoverPointerDown);

  return () => {
    closePopover(root, field, state);
    trigger?.removeEventListener("click", onTriggerClick);
    allBtn?.removeEventListener("click", onAllClick);
    popover?.removeEventListener("change", onOptionChange);
    popover?.removeEventListener("pointerdown", onPopoverPointerDown);
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
  updateSummary(root, field);
}
