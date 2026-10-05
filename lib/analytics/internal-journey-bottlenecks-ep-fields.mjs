/** Resolução de campos EP — sem reunião (pct prioritário, count opcional). */

export function pickFiniteNumber(...candidates) {
  for (const value of candidates) {
    if (value != null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

/**
 * @returns {{ count: number | null, pct: number | null }}
 */
export function resolveEpWithoutMeetingFields(row) {
  if (!row || typeof row !== "object") return { count: null, pct: null };
  const pctVal = pickFiniteNumber(row.withoutMeetingPct, row.semReuniaoPct, row.sem_reuniao_pct);
  let count = pickFiniteNumber(
    row.withoutMeetingCount,
    row.withoutMeeting,
    row.semReuniaoCount,
    row.sem_reuniao_count,
  );
  if (count === 0 && pctVal != null && pctVal > 0) count = null;
  return { count, pct: pctVal };
}

export function epWithoutMeetingAlert(row, pctVal) {
  const pct = pctVal ?? resolveEpWithoutMeetingFields(row).pct;
  return !row?.smallSample && pct != null && pct > 40;
}

export function formatEpWithoutMeetingCellTooltip(row, formatCount, formatPct) {
  const { count, pct: pctVal } = resolveEpWithoutMeetingFields(row);
  const alert = epWithoutMeetingAlert(row, pctVal);
  let tip;
  if (count != null && pctVal != null) {
    tip = `${formatCount(count)} clientes sem reunião — ${formatPct(pctVal)} da carteira deste EP.`;
  } else if (pctVal != null) {
    tip = `${formatPct(pctVal)} dos clientes deste EP não possuem reunião registrada.`;
  } else {
    tip = "Sem dado para este EP.";
  }
  if (alert) tip += " Ponto de atenção: mais de 40% da carteira deste EP está sem reunião.";
  if (row?.smallSample) tip += " Interprete com cautela: poucos clientes neste EP.";
  return tip;
}
