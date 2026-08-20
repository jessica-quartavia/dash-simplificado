/**
 * Busca global de tabelas: nome, código e ID.
 * Case insensitive, accent insensitive, trim, parcial.
 */

export const DEFAULT_SEARCH_FIELDS = {
  name: "clientName",
  code: "clientCode",
  id: "clientId",
};

export function foldSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesSearch(row, query, fields = DEFAULT_SEARCH_FIELDS) {
  const needle = foldSearchText(query);
  if (!needle) return true;
  const keys = [fields.name, fields.code, fields.id].filter(Boolean);
  const hay = keys.map((key) => foldSearchText(row?.[key])).join(" ");
  return hay.includes(needle);
}

export function debounce(fn, waitMs = 300) {
  let timer = 0;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
  };
  return wrapped;
}
