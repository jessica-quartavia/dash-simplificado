/**
 * Cobertura de campos Qualidade via scan em memória — substitui N× count=exact.
 * Preserva semântica PostgREST: is.null vs or(null,eq.).
 */
import { fetchAllRows } from "../data/supabase-rest.mjs";

const TABLE_COUNT_SELECT = {
  client_implementation_meeting_date: "client_id",
  vw_info_cliente: "id_cliente",
};

export function countSelectColumn(table) {
  return TABLE_COUNT_SELECT[table] || "id";
}

export function isMissingFieldValue(value, includeBlank = false) {
  if (value == null) return true;
  if (includeBlank && typeof value === "string" && value.trim() === "") return true;
  return false;
}

export function buildTableColumnMap(fields = []) {
  const map = new Map();
  for (const [, table, column] of fields) {
    if (!map.has(table)) map.set(table, new Set());
    map.get(table).add(column);
    map.get(table).add(countSelectColumn(table));
  }
  return map;
}

export function computeCoverageFromRows(rows, column, includeBlank = false) {
  const totalRows = rows.length;
  let missingRows = 0;
  for (const row of rows) {
    if (isMissingFieldValue(row?.[column], includeBlank)) missingRows += 1;
  }
  return { totalRows, missingRows };
}

export async function loadQualityTableRows(table, columns) {
  const select = [...columns].sort().join(",");
  const order = `${countSelectColumn(table)}.asc`;
  return fetchAllRows({ table, select, order });
}

/**
 * @param {Array<[string,string,string,boolean]>} fields
 * @param {{ optionalTables?: Set<string> }} opts
 */
export async function scanFieldCoverage(fields, { optionalTables = new Set() } = {}) {
  const tableMap = buildTableColumnMap(fields);
  const rowsByTable = new Map();
  const loadErrors = new Map();

  await Promise.all([...tableMap.entries()].map(async ([table, columns]) => {
    try {
      const rows = await loadQualityTableRows(table, columns);
      rowsByTable.set(table, rows);
    } catch (error) {
      if (optionalTables.has(table)) {
        loadErrors.set(table, error);
        rowsByTable.set(table, []);
        return;
      }
      throw error;
    }
  }));

  const items = fields.map(([domain, table, column, includeBlank]) => {
    const rows = rowsByTable.get(table) || [];
    const { totalRows, missingRows } = computeCoverageFromRows(rows, column, includeBlank);
    return { domain, table, column, totalRows, missingRows, includeBlank };
  });

  return { items, rowsByTable, loadErrors };
}
