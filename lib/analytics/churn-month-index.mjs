/**
 * Índice DEV — clientes por mês na série analítica de churn (dedupe por client_id).
 */
import {
  analyticalCancellationDateFromRow,
  rowCountsForAnalyticalChurn,
} from "./analytical-cancellation.mjs";
import { currentMonthKeyLocal, monthKey } from "./general-metrics.mjs";

export function buildChurnMonthClientIndex(rows, now = new Date()) {
  const nowKey = currentMonthKeyLocal(now);
  const byMonth = new Map();
  let anonSeq = 0;

  for (const row of rows || []) {
    if (!rowCountsForAnalyticalChurn(row)) continue;
    const d = analyticalCancellationDateFromRow(row);
    if (!d) continue;
    const key = monthKey(d);
    if (key > nowKey) continue;
    const clientId = String(row.clientId ?? row.client_id ?? "").trim();
    const id = clientId || `__anon_${anonSeq++}`;
    if (!byMonth.has(key)) byMonth.set(key, new Set());
    byMonth.get(key).add(id);
  }
  return byMonth;
}
