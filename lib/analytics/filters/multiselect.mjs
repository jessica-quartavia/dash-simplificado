/**
 * Semântica multiselect (Analytics V2):
 * - Dentro do mesmo filtro: OR entre opções selecionadas.
 * - Entre filtros diferentes: AND (Status AND EP AND multiselect…).
 * - Ausência de seleção / "Todos": sem recorte naquele eixo.
 */

export function normalizeMultiSelectFilter(value) {
  if (value == null || value === "" || value === "all") return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  }
  return [];
}

export function multiSelectIsActive(value) {
  return normalizeMultiSelectFilter(value).length > 0;
}

/**
 * @param {object} row
 * @param {string[]|string} selectedValues
 * @param {Record<string, (row: object) => boolean>} matchers keyed by option value
 */
export function multiSelectOrMatch(row, selectedValues, matchers = {}) {
  const selected = normalizeMultiSelectFilter(selectedValues);
  if (!selected.length) return true;
  return selected.some((key) => {
    const fn = matchers[key];
    return typeof fn === "function" ? fn(row) : false;
  });
}

export function summarizeMultiSelectLabel(options = [], selectedValues = [], {
  allLabel = "Todos",
  maxChars = 28,
} = {}) {
  const selected = normalizeMultiSelectFilter(selectedValues);
  if (!selected.length) return allLabel;

  const labels = selected.map((value) => {
    const opt = options.find((item) => (item.value ?? item) === value);
    return opt?.label ?? opt?.value ?? value;
  });

  if (labels.length === 1) return truncateLabel(labels[0], maxChars);

  const compact = labels.map((label) => shortLabel(label)).join(" + ");
  if (compact.length <= maxChars) return compact;

  return `${labels.length} selecionados`;
}

function shortLabel(label) {
  const text = String(label || "");
  if (text.length <= 14) return text;
  return text.replace(/^Possui\s+/i, "").trim();
}

function truncateLabel(label, maxChars) {
  const text = String(label || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function serializeMultiSelectValue(values) {
  return normalizeMultiSelectFilter(values).join(",");
}

export function parseMultiSelectValue(raw) {
  return normalizeMultiSelectFilter(raw);
}
