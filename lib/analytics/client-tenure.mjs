/**
 * Permanência analítica oficial do portal (BASE QV).
 *
 * Permanência base (cronológica):
 * - cancelado com data válida → cancelamento − contratação
 * - demais elegíveis → hoje (America/Sao_Paulo) − contratação
 *
 * Ajuste de renovação (apenas indicador analítico):
 * - se currentCycle >= 2 e permanência base < 365 → base + 365
 * - caso contrário → base
 *
 * NÃO usar o ajuste em Kaplan–Meier nem em cohort (duração cronológica real).
 *
 * Observação de produto (não implementada): um campo `data_primeiro_ciclo`
 * ajudaria o cálculo de ciclo. Não existe na BASE QV — não criar o campo.
 */
import { civilDateInSaoPaulo, calendarDateFromValue } from "./client-cycle-renewal.mjs";

const MS_DAY = 86400000;
export const RENEWAL_TENURE_BONUS_DAYS = 365;
export const RENEWAL_TENURE_CYCLE_MIN = 2;

function parseYmdParts(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd).slice(0, 10))) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** Diferença em dias civis entre duas datas YYYY-MM-DD (ou Date/ISO). */
export function tenureDaysBetween(start, end) {
  const a = typeof start === "string" && /^\d{4}-\d{2}-\d{2}/.test(start)
    ? start.slice(0, 10)
    : calendarDateFromValue(start);
  const b = typeof end === "string" && /^\d{4}-\d{2}-\d{2}/.test(end)
    ? end.slice(0, 10)
    : calendarDateFromValue(end);
  const pa = parseYmdParts(a);
  const pb = parseYmdParts(b);
  if (!pa || !pb) return null;
  const t0 = Date.UTC(pa.y, pa.m - 1, pa.d);
  const t1 = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.floor((t1 - t0) / MS_DAY);
}

export function todayYmdSaoPaulo(now = new Date()) {
  return civilDateInSaoPaulo(now instanceof Date ? now : new Date(now));
}

/**
 * Ajuste de renovação sobre a permanência base.
 * Uma única soma de +365 quando ciclo >= 2 e base < 365.
 */
export function applyRenewalTenureAdjustment(baseDays, currentCycle) {
  if (baseDays == null || !Number.isFinite(Number(baseDays))) return null;
  const base = Number(baseDays);
  if (base < 0) return null;
  const cycle = Number(currentCycle);
  if (Number.isFinite(cycle) && cycle >= RENEWAL_TENURE_CYCLE_MIN && base < RENEWAL_TENURE_BONUS_DAYS) {
    return base + RENEWAL_TENURE_BONUS_DAYS;
  }
  return base;
}

/**
 * Permanência base cronológica (sem +365).
 * @param {{ hireDate: Date|string|null, endDate?: Date|string|null, cancellationDate?: Date|string|null, isCancelledWithDate?: boolean, isCancelled?: boolean, now?: Date|string }} opts
 */
export function calculateBaseTenureDays(opts = {}) {
  const hire = opts.hireDate != null
    ? (typeof opts.hireDate === "string" ? opts.hireDate.slice(0, 10) : calendarDateFromValue(opts.hireDate))
    : null;
  if (!hire) {
    return { stayDaysBase: null, status: "missing_hire", warning: "Sem data de contratação — permanência excluída" };
  }
  const nowYmd = opts.now != null
    ? (typeof opts.now === "string" ? String(opts.now).slice(0, 10) : todayYmdSaoPaulo(opts.now))
    : todayYmdSaoPaulo(new Date());

  if (hire > nowYmd) {
    return { stayDaysBase: null, status: "future_hire", warning: "Contratação futura — permanência excluída" };
  }

  let end = null;
  let status = "calculated_current_date";
  if (opts.endDate != null) {
    end = typeof opts.endDate === "string" ? opts.endDate.slice(0, 10) : calendarDateFromValue(opts.endDate);
    status = "calculated_end_date";
  } else if (opts.isCancelledWithDate || (opts.isCancelled && opts.cancellationDate)) {
    end = typeof opts.cancellationDate === "string"
      ? opts.cancellationDate.slice(0, 10)
      : calendarDateFromValue(opts.cancellationDate);
    if (!end) {
      return { stayDaysBase: null, status: "missing_cancellation_date", warning: "Cancelado sem data válida — permanência excluída" };
    }
    status = "calculated_cancellation_date";
  } else if (opts.isCancelled) {
    return { stayDaysBase: null, status: "missing_cancellation_date", warning: "Cancelado sem data válida — permanência excluída" };
  } else {
    end = nowYmd;
    status = "calculated_current_date";
  }

  const days = tenureDaysBetween(hire, end);
  if (days == null) {
    return { stayDaysBase: null, status: "invalid_dates", warning: "Datas inválidas — permanência excluída" };
  }
  if (days < 0) {
    return { stayDaysBase: null, status: "negative_stay", warning: "Permanência negativa (cancelamento anterior à contratação)" };
  }
  return { stayDaysBase: days, status, warning: null, hireYmd: hire, endYmd: end };
}

/**
 * Permanência analítica oficial = base + ajuste de renovação.
 * stayDaysChronological === stayDaysBase (para sobrevivência/cohort).
 */
export function calculateAnalyticalTenure(opts = {}) {
  const base = calculateBaseTenureDays(opts);
  const stayDaysBase = base.stayDaysBase;
  const stayDays = applyRenewalTenureAdjustment(stayDaysBase, opts.currentCycle);
  return {
    stayDaysBase,
    stayDaysChronological: stayDaysBase,
    stayDays,
    adjusted: stayDays != null && stayDaysBase != null && stayDays !== stayDaysBase,
    status: base.status,
    warning: base.warning,
    hireYmd: base.hireYmd || null,
    endYmd: base.endYmd || null,
  };
}

/** Alias pedido na especificação. */
export const calculateAdjustedTenure = calculateAnalyticalTenure;
export const getAnalyticalTenure = calculateAnalyticalTenure;
export const calculateClientTenure = calculateAnalyticalTenure;

export function stayMonthsFromDays(days) {
  if (days == null || !Number.isFinite(Number(days))) return null;
  return Math.round((Number(days) / 30.4375) * 10) / 10;
}

export function stayRangeFromMonths(months) {
  if (months == null) return "Dados insuficientes";
  if (months <= 3) return "Até 3 meses";
  if (months <= 6) return "De 4 a 6 meses";
  if (months <= 12) return "De 7 a 12 meses";
  if (months <= 24) return "De 13 a 24 meses";
  return "Mais de 24 meses";
}

/**
 * Compatível com resolveStayPeriod de Dados Gerais, com ajuste de renovação.
 */
export function resolveAnalyticalStayPeriod({
  stayStartDate,
  analyticalStatus,
  cancellationDate,
  now,
  currentCycle,
}) {
  const isActiveOrFrozen = analyticalStatus === "Ativo" || analyticalStatus === "Congelado";
  const cancelledStatuses = new Set([
    "Cancelado",
    "Cancelamento efetivado",
    "Efetivado",
  ]);
  // Aceita status já normalizados do portal
  const status = String(analyticalStatus || "");
  const looksCancelled = /cancel/i.test(status) && !isActiveOrFrozen;

  let isCancelledWithDate = false;
  let isCancelled = false;
  if (isActiveOrFrozen) {
    isCancelled = false;
  } else if (cancellationDate && (looksCancelled || cancelledStatuses.has(status) || status === "Cancelado")) {
    isCancelled = true;
    isCancelledWithDate = true;
  } else if (looksCancelled || /encerrado|efetivad/i.test(status)) {
    isCancelled = true;
    isCancelledWithDate = Boolean(cancellationDate);
  }

  const result = calculateAnalyticalTenure({
    hireDate: stayStartDate,
    cancellationDate,
    isCancelledWithDate: isCancelledWithDate && Boolean(cancellationDate),
    isCancelled,
    now: now || new Date(),
    currentCycle,
  });

  const months = stayMonthsFromDays(result.stayDays);
  return {
    stayDaysBase: result.stayDaysBase,
    stayDays: result.stayDays,
    stayDaysChronological: result.stayDaysChronological,
    stayAdjusted: result.adjusted,
    stayMonths: months,
    stayRange: stayRangeFromMonths(months),
    stayCalculationStatus: result.status,
    stayUsedCurrentDate: result.status === "calculated_current_date",
    warning: result.warning,
  };
}
