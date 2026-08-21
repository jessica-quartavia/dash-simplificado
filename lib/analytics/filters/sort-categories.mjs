/**
 * Ordenação categórica global — categorias desconhecidas / "Não informado" sempre por último.
 */

const UNKNOWN_TOKENS = new Set([
  "nao informado",
  "não informado",
  "sem informacao",
  "sem informação",
  "desconhecido",
  "unknown",
  "null",
  "undefined",
  "vazio",
  "dados insuficientes",
  "nao informada",
  "não informada",
  "sem dado",
  "nao classificado",
  "não classificado",
]);

export function foldCategoryLabel(raw) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isUnknownCategoryLabel(raw) {
  const token = foldCategoryLabel(raw);
  if (!token) return true;
  if (UNKNOWN_TOKENS.has(token)) return true;
  return token.startsWith("nao informad") || token.startsWith("sem inform");
}

/**
 * Ordena itens mantendo compareFn para categorias conhecidas;
 * desconhecidos / "Não informado" vão ao final.
 */
export function sortUnknownLast(items, getLabel, compareFn = null) {
  const list = Array.isArray(items) ? [...items] : [];
  const known = [];
  const unknown = [];
  for (const item of list) {
    const label = typeof getLabel === "function" ? getLabel(item) : item?.label ?? item;
    if (isUnknownCategoryLabel(label)) unknown.push(item);
    else known.push(item);
  }
  if (compareFn) known.sort(compareFn);
  else {
    known.sort((a, b) => {
      const la = typeof getLabel === "function" ? getLabel(a) : a?.label ?? a;
      const lb = typeof getLabel === "function" ? getLabel(b) : b?.label ?? b;
      return String(la).localeCompare(String(lb), "pt-BR", { numeric: true });
    });
  }
  unknown.sort((a, b) => {
    const la = typeof getLabel === "function" ? getLabel(a) : a?.label ?? a;
    const lb = typeof getLabel === "function" ? getLabel(b) : b?.label ?? b;
    return String(la).localeCompare(String(lb), "pt-BR", { numeric: true });
  });
  return [...known, ...unknown];
}

/** Ordena rótulos para selects/filtros (alfabético, desconhecido por último). */
export function sortLabelsUnknownLast(labels = []) {
  return sortUnknownLast([...new Set(labels.filter(Boolean))], (x) => x);
}

/** Ordena distribuições { label, count } por count desc, desconhecido por último. */
export function sortDistributionUnknownLast(items = []) {
  return sortUnknownLast(items, (item) => item?.label, (a, b) => {
    const diff = (b.count || 0) - (a.count || 0);
    if (diff) return diff;
    return String(a.label).localeCompare(String(b.label), "pt-BR", { numeric: true });
  });
}
