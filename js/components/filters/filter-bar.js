import { escapeHtml } from "../../general-charts.mjs";
import { debounce } from "../../../lib/analytics/filters/search.mjs";
import { sortLabelsUnknownLast } from "../../../lib/analytics/filters/sort-categories.mjs";
import { bindDateRangePicker, renderDateRangePicker } from "./date-range-picker.js";
import { bindMultiSelectFilter, renderMultiSelectFilter } from "./multi-select-filter.js";
import { bindSelectFilter, renderSelectFilterFromField, updateSelectFilterField } from "./select-filter.js";

function optionHtml(options, selected) {
  return (options || [])
    .map((item) => {
      const value = item.value ?? item;
      const label = item.label ?? item;
      return `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

export function renderFilterBar({
  fields,
  filters,
  note = "",
  periodInvalid = false,
} = {}) {
  const controls = (fields || []).map((field) => {
    if (field.kind === "search") {
      return `<label class="filter-search">Busca<input id="${escapeHtml(field.id)}" type="search" placeholder="Nome, código ou ID" value="${escapeHtml(filters.search || "")}" /></label>`;
    }
    if (field.kind === "period") {
      return renderDateRangePicker({ field, filters, label: "Período" });
    }
    if (field.kind === "multiselect") {
      return renderMultiSelectFilter({ field, filters, label: field.label });
    }
    if (field.kind === "selectfilter") {
      return renderSelectFilterFromField(field, filters);
    }
    if (field.kind === "select") {
      const options = field.dynamic
        ? `<option value="all">${escapeHtml(field.allLabel || "Todos")}</option>`
        : optionHtml(field.options, filters[field.key]);
      return `<label>${escapeHtml(field.label)}<select id="${escapeHtml(field.id)}">${options}</select></label>`;
    }
    if (field.kind === "number") {
      const val = filters[field.key] ?? field.default ?? "";
      const min = field.min != null ? ` min="${field.min}"` : "";
      const max = field.max != null ? ` max="${field.max}"` : "";
      const step = field.step != null ? ` step="${field.step}"` : "";
      return `<label>${escapeHtml(field.label)}<input id="${escapeHtml(field.id)}" type="number"${min}${max}${step} value="${escapeHtml(String(val))}" title="${escapeHtml(field.title || "")}" /></label>`;
    }
    return "";
  });
  const error = periodInvalid
    ? `<p class="filter-error">Selecione um intervalo válido. Datas futuras não são permitidas.</p>`
    : "";
  const noteHtml = note ? `<p class="filter-semantics">${escapeHtml(note)}</p>` : "";
  return `
    <div class="filter-bar">
      ${controls.join("")}
      <div class="filter-actions">
        <button class="btn btn-secondary" type="button" data-filter-clear>Limpar</button>
      </div>
    </div>
    ${error}
    ${noteHtml}
  `;
}

export function bindFilterBar({
  host,
  fields,
  filters = {},
  onChange,
  onClear,
  searchDebounceMs = 300,
} = {}) {
  if (!host) return () => {};
  const cleanups = [];
  for (const field of fields || []) {
    if (field.kind === "search") {
      const el = host.querySelector(`#${field.id}`);
      if (!el) continue;
      const run = debounce(() => onChange?.(), searchDebounceMs);
      const handler = () => run();
      el.addEventListener("input", handler);
      cleanups.push(() => {
        run.cancel?.();
        el.removeEventListener("input", handler);
      });
      continue;
    }
    if (field.kind === "period") {
      cleanups.push(
        bindDateRangePicker({
          host,
          field,
          filters,
          onApply: (next) => onChange?.(next),
        }),
      );
      continue;
    }
    if (field.kind === "multiselect") {
      cleanups.push(
        bindMultiSelectFilter({
          host,
          field,
          filters,
          onChange: () => onChange?.(),
        }),
      );
      continue;
    }
    if (field.kind === "selectfilter") {
      cleanups.push(
        bindSelectFilter({
          host,
          field,
          onChange: () => onChange?.(),
        }),
      );
      continue;
    }
    if (field.kind === "number") {
      const el = host.querySelector(`#${field.id}`);
      if (!el) continue;
      const handler = () => onChange?.();
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
      cleanups.push(() => {
        el.removeEventListener("input", handler);
        el.removeEventListener("change", handler);
      });
      continue;
    }
    const el = field.id ? host.querySelector(`#${field.id}`) : null;
    if (!el) continue;
    const handler = () => onChange?.();
    el.addEventListener("change", handler);
    cleanups.push(() => el.removeEventListener("change", handler));
  }
  const clear = host.querySelector("[data-filter-clear]");
  if (clear && onClear) {
    clear.addEventListener("click", onClear);
    cleanups.push(() => clear.removeEventListener("click", onClear));
  }
  return () => cleanups.forEach((fn) => fn());
}

export function readFilterValue(id, fallback = "") {
  return document.getElementById(id)?.value || fallback;
}

export function renderTableToolbar({ countLabel, exportPrefix }) {
  return `
    <div class="table-toolbar">
      <p class="table-count">${escapeHtml(countLabel)}</p>
      <div class="table-export" role="group" aria-label="Exportar">
        <span class="table-export-label">Exportar</span>
        <button class="btn btn-secondary btn-export" type="button" data-export="csv" data-export-prefix="${escapeHtml(exportPrefix || "")}">CSV</button>
        <button class="btn btn-secondary btn-export" type="button" data-export="xlsx" data-export-prefix="${escapeHtml(exportPrefix || "")}">Excel</button>
      </div>
    </div>
  `;
}

export function bindTableExport(root, handler) {
  root?.querySelectorAll("[data-export]")?.forEach((btn) => {
    btn.addEventListener("click", () => handler(btn.dataset.export));
  });
}

export function fillDynamicSelect(select, values, allLabel, current) {
  if (!select) return;
  const keep = current ?? select.value ?? "all";
  const sorted = sortLabelsUnknownLast(values);
  select.innerHTML =
    `<option value="all">${escapeHtml(allLabel)}</option>` +
    sorted.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  select.value = [...select.options].some((opt) => opt.value === keep) ? keep : "all";
}

/** Atualiza opções de SelectFilter dinâmico (Cancelamento / Satisfação). */
export function fillDynamicSelectFilter(host, field, values, allLabel, current) {
  updateSelectFilterField(host, field, values, current ?? "all");
}
