/**
 * SelectFilter — single-select com popover moderno (visual alinhado ao multiselect).
 */
import { escapeHtml } from "../../general-charts.mjs";
import {
  closeOpenDropdown,
  registerOpenDropdown,
  unregisterOpenDropdown,
} from "../dropdown-coordinator.js";
import {
  ensureOverlayRoot,
  eventPathIncludes,
  mountPopoverPortal,
  positionAnchoredPopover,
  unmountPopoverPortal,
} from "../overlay-root.js";

function normalizeOptions(options = []) {
  return options.map((option) => {
    if (option == null) return { value: "", label: "" };
    if (typeof option === "string") return { value: option, label: option };
    return { value: option.value ?? option.label ?? "", label: option.label ?? option.value ?? "" };
  });
}

function selectedLabelFor(value, options, allLabel) {
  if (!value || value === "all") return allLabel;
  const match = options.find((option) => String(option.value) === String(value));
  return match?.label || value;
}

export function renderSelectFilter({
  id,
  label,
  options = [],
  value = "all",
  allLabel = "Todos",
  searchable = false,
} = {}) {
  const normalized = normalizeOptions(options);
  const selected = value || "all";
  const summary = selectedLabelFor(selected, normalized, allLabel);

  const items = [
    `<button type="button" class="sf-option${selected === "all" ? " is-selected" : ""}" data-sf-value="all" role="option">${escapeHtml(allLabel)}</button>`,
    ...normalized.map((option) => {
      const val = String(option.value);
      return `<button type="button" class="sf-option${val === String(selected) ? " is-selected" : ""}" data-sf-value="${escapeHtml(val)}" role="option">${escapeHtml(option.label)}</button>`;
    }),
  ].join("");

  const search = searchable
    ? `<input type="search" class="sf-search" data-sf-search placeholder="Buscar…" aria-label="Buscar opções" />`
    : "";

  return `
    <div class="select-filter" data-sf-root data-sf-id="${escapeHtml(id)}" data-sf-all-label="${escapeHtml(allLabel)}">
      <span class="sf-label">${escapeHtml(label)}</span>
      <button type="button" class="sf-trigger" data-sf-trigger aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(label)}">
        <span class="sf-summary" data-sf-summary title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
        <span class="sf-chevron" aria-hidden="true">▾</span>
      </button>
      <input type="hidden" id="${escapeHtml(id)}" value="${escapeHtml(selected)}" />
      <div class="sf-popover" data-sf-popover data-drp-popover hidden role="listbox" aria-label="${escapeHtml(label)}">
        ${search}
        <div class="sf-options">${items}</div>
      </div>
    </div>`;
}

export function renderSelectFilterFromField(field, filters = {}) {
  const options = field.dynamic ? field.dynamicOptions || [] : field.options || [];
  return renderSelectFilter({
    id: field.id,
    label: field.label,
    options,
    value: filters[field.key] ?? "all",
    allLabel: field.allLabel || "Todos",
    searchable: field.searchable ?? normalizeOptions(options).length > 8,
  });
}

function isSelectInsideEvent(event, { root, trigger, popover, backdrop } = {}) {
  return eventPathIncludes(event, [root, trigger, popover, backdrop]);
}

function closeSelectPopover(root, state, { focusTrigger = false } = {}) {
  if (!state.open) return;
  state.open = false;
  unregisterOpenDropdown(state.controller);
  const trigger = root.querySelector("[data-sf-trigger]");
  const popover = root.querySelector("[data-sf-popover]");
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

function openSelectPopover(root, state) {
  const trigger = root.querySelector("[data-sf-trigger]");
  const popover = root.querySelector("[data-sf-popover]");
  if (!trigger || !popover) return;

  closeOpenDropdown();
  state.open = true;
  trigger.setAttribute("aria-expanded", "true");
  const mounted = mountPopoverPortal({
    anchor: trigger,
    popover,
    overlayRoot: ensureOverlayRoot(),
    onDismiss: () => closeSelectPopover(root, state),
  });
  state.overlayRoot = mounted.overlayRoot;
  state.backdrop = mounted.backdrop;

  state.onPointerDown = (event) => {
    if (!state.open) return;
    if (isSelectInsideEvent(event, { root, trigger, popover, backdrop: state.backdrop })) return;
    closeSelectPopover(root, state);
  };
  state.onKeyDown = (event) => {
    if (event.key !== "Escape" || !state.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeSelectPopover(root, state, { focusTrigger: true });
  };
  state.onViewportChange = () => {
    if (!state.open) return;
    positionAnchoredPopover({ anchor: trigger, popover });
  };

  document.addEventListener("pointerdown", state.onPointerDown, true);
  document.addEventListener("keydown", state.onKeyDown, true);
  window.addEventListener("scroll", state.onViewportChange, true);
  window.addEventListener("resize", state.onViewportChange);
  registerOpenDropdown(() => closeSelectPopover(root, state));
  positionAnchoredPopover({ anchor: trigger, popover });
}

function rebuildOptions(root, options, selected, allLabel) {
  const list = root.querySelector(".sf-options");
  if (!list) return;
  const normalized = normalizeOptions(options);
  list.innerHTML = [
    `<button type="button" class="sf-option${selected === "all" ? " is-selected" : ""}" data-sf-value="all" role="option">${escapeHtml(allLabel)}</button>`,
    ...normalized.map((option) => {
      const val = String(option.value);
      return `<button type="button" class="sf-option${val === String(selected) ? " is-selected" : ""}" data-sf-value="${escapeHtml(val)}" role="option">${escapeHtml(option.label)}</button>`;
    }),
  ].join("");
  const summary = root.querySelector("[data-sf-summary]");
  const text = selectedLabelFor(selected, normalized, allLabel);
  if (summary) {
    summary.textContent = text;
    summary.title = text;
  }
}

export function updateSelectFilterField(host, field, values, current) {
  const root = host?.querySelector?.(`[data-sf-id="${field.id}"]`) || document.querySelector(`[data-sf-id="${field.id}"]`);
  if (!root) return;
  const allLabel = field.allLabel || root.dataset.sfAllLabel || "Todos";
  const keep = current ?? root.querySelector('input[type="hidden"]')?.value ?? "all";
  const options = normalizeOptions(values).filter((item) => item.value);
  const next = options.some((item) => String(item.value) === String(keep)) ? keep : "all";
  const hidden = root.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = next;
  rebuildOptions(root, options, next, allLabel);
}

export function bindSelectFilter({ host, field, onChange } = {}) {
  const root = host?.querySelector?.(`[data-sf-id="${field.id}"]`);
  if (!root) return () => {};

  if (typeof root._sfCleanup === "function") {
    root._sfCleanup();
    root._sfCleanup = null;
  }

  const state = { open: false, overlayRoot: null, backdrop: null, controller: null };
  state.controller = () => closeSelectPopover(root, state);

  const trigger = root.querySelector("[data-sf-trigger]");
  const popover = root.querySelector("[data-sf-popover]");
  const hidden = root.querySelector('input[type="hidden"]');
  const summary = root.querySelector("[data-sf-summary]");

  const setValue = (next, labelText) => {
    if (hidden) hidden.value = next;
    if (summary) {
      summary.textContent = labelText;
      summary.title = labelText;
    }
    popover?.querySelectorAll(".sf-option").forEach((el) => {
      el.classList.toggle("is-selected", el.getAttribute("data-sf-value") === next);
    });
  };

  const onTriggerClick = () => {
    if (state.open) closeSelectPopover(root, state);
    else openSelectPopover(root, state);
  };

  const onOptionClick = (event) => {
    const option = event.target.closest("[data-sf-value]");
    if (!option) return;
    const next = option.getAttribute("data-sf-value") || "all";
    setValue(next, option.textContent.trim());
    closeSelectPopover(root, state);
    onChange?.();
  };

  const onSearchInput = (event) => {
    const q = String(event.target.value || "").trim().toLowerCase();
    popover?.querySelectorAll(".sf-option").forEach((el) => {
      el.hidden = q ? !el.textContent.toLowerCase().includes(q) : false;
    });
  };

  const onTriggerKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTriggerClick();
    }
    if (event.key === "ArrowDown" && !state.open) {
      event.preventDefault();
      openSelectPopover(root, state);
    }
  };

  trigger?.addEventListener("click", onTriggerClick);
  trigger?.addEventListener("keydown", onTriggerKeyDown);
  popover?.addEventListener("click", onOptionClick);
  popover?.querySelector("[data-sf-search]")?.addEventListener("input", onSearchInput);

  root._sfCleanup = () => {
    closeSelectPopover(root, state);
    trigger?.removeEventListener("click", onTriggerClick);
    trigger?.removeEventListener("keydown", onTriggerKeyDown);
    popover?.removeEventListener("click", onOptionClick);
    popover?.querySelector("[data-sf-search]")?.removeEventListener("input", onSearchInput);
    root._sfCleanup = null;
  };
  return root._sfCleanup;
}

export function bindSelectFilters(root = document, onChange) {
  const cleanups = [];
  root.querySelectorAll("[data-sf-root]").forEach((container) => {
    const id = container.dataset.sfId;
    if (!id) return;
    cleanups.push(bindSelectFilter({ host: container.parentElement || root, field: { id }, onChange }));
  });
  return () => cleanups.forEach((fn) => fn());
}
