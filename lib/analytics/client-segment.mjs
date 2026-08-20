/**
 * Segmentação por capacidade financeira — regra vigente da V1 (Dados Gerais).
 * Prioridade: DEBTS > APEX > PRIVATE > PRINCIPAL > OVER > Dados insuficientes.
 * Sem renda válida e sem evidência APEX/dívida → "Dados insuficientes".
 * Não inventa classificação.
 */

export const INSUFFICIENT_SEGMENT_LABEL = "Dados insuficientes";
export const SEGMENT_LABELS = ["APEX", "PRIVATE", "PRINCIPAL", "DEBTS", "OVER", INSUFFICIENT_SEGMENT_LABEL];

const DEBT_FIELDS = [
  { key: "cheque_especial", label: "cheque especial" },
  { key: "parcelamento_cartao", label: "parcelamento de cartão" },
  { key: "credito_pessoal", label: "crédito pessoal" },
  { key: "credito_consignado", label: "crédito consignado" },
];

export function hasValidFinancialValue(value) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return false;
    return Number.isFinite(Number(s.replace(",", ".")));
  }
  return false;
}

export function normalizeDebtFlag(raw) {
  if (raw == null) return { isDebt: false, known: false, unrecognized: false };
  if (typeof raw === "boolean") return { isDebt: raw, known: true, unrecognized: false };
  if (typeof raw === "number") return { isDebt: raw !== 0, known: true, unrecognized: false };
  const s = String(raw).trim().toLowerCase();
  if (!s) return { isDebt: false, known: false, unrecognized: false };
  if (["true", "t", "1", "sim", "yes", "y", "possui", "ativo"].includes(s)) {
    return { isDebt: true, known: true, unrecognized: false };
  }
  if (["false", "f", "0", "nao", "não", "no", "n", "vazio", "nenhum", "nenhuma"].includes(s)) {
    return { isDebt: false, known: true, unrecognized: false };
  }
  return { isDebt: false, known: false, unrecognized: true };
}

export function calculateClientSegment(financialData, debtData) {
  const segmentWarnings = [];
  const monthlyIncome = financialData?.monthlyIncome ?? null;
  const liquidityReserve = financialData?.liquidityReserve ?? null;
  const lastContribution = financialData?.lastContribution ?? null;
  const paidPropertiesValue = financialData?.paidPropertiesValue ?? null;

  if (monthlyIncome != null && monthlyIncome < 0) segmentWarnings.push("Renda mensal negativa");
  if (liquidityReserve != null && liquidityReserve < 0) segmentWarnings.push("Reserva de liquidez negativa");
  if (lastContribution != null && lastContribution < 0) segmentWarnings.push("Último aporte negativo");
  if (paidPropertiesValue != null && paidPropertiesValue < 0) {
    segmentWarnings.push("Valor de imóveis quitados negativo");
  }

  const hasValidMonthlyIncome = hasValidFinancialValue(monthlyIncome) && monthlyIncome >= 0;

  const debtReasons = [];
  let anyDebt = false;
  let anyDebtKnown = false;
  for (const field of DEBT_FIELDS) {
    const norm = normalizeDebtFlag(debtData?.[field.key]);
    if (norm.unrecognized) segmentWarnings.push(`Dívida com formato não reconhecido: ${field.key}`);
    if (norm.known) anyDebtKnown = true;
    if (norm.isDebt) {
      anyDebt = true;
      debtReasons.push(`Possui ${field.label} registrado`);
    }
  }
  const debtDataAvailable = anyDebtKnown;

  const missingFinancialData = [];
  if (!hasValidMonthlyIncome) missingFinancialData.push("renda mensal");
  if (!debtDataAvailable) missingFinancialData.push("informação de dívida");
  if (!hasValidFinancialValue(liquidityReserve)) missingFinancialData.push("reserva de liquidez");
  if (!hasValidFinancialValue(paidPropertiesValue)) missingFinancialData.push("valor dos imóveis quitados");
  if (!hasValidFinancialValue(lastContribution)) missingFinancialData.push("último aporte");

  const segmentInputs = {
    monthlyIncome,
    liquidityReserve,
    lastContribution,
    paidPropertiesValue,
    hasDebt: anyDebt,
    debtDataAvailable,
  };

  const build = (segment, reasons, confidence) => {
    if ((segment === "PRIVATE" || segment === "PRINCIPAL" || segment === "OVER") && !hasValidMonthlyIncome) {
      segmentWarnings.push(`Segmento ${segment} atribuído sem renda válida`);
    }
    if (segment === "APEX" && !reasons.length) segmentWarnings.push("Cliente APEX sem nenhum critério APEX");
    if (segment === "DEBTS" && !reasons.length) segmentWarnings.push("Cliente DEBTS sem evidência de dívida");
    if (confidence === "medium") {
      segmentWarnings.push("Informação de dívida não disponível; classificação feita somente com base financeira.");
    }
    return {
      segment,
      segmentLabel: segment,
      segmentStatus: "classified",
      segmentConfidence: confidence,
      segmentReason: reasons[0] || null,
      segmentReasons: reasons,
      segmentInputs,
      missingFinancialData,
      segmentWarnings,
    };
  };

  if (anyDebt) return build("DEBTS", debtReasons, "high");

  const apexReasons = [];
  if (hasValidFinancialValue(monthlyIncome) && monthlyIncome >= 100000) {
    apexReasons.push("Renda mensal igual ou superior a R$ 100 mil");
  }
  if (hasValidFinancialValue(paidPropertiesValue) && paidPropertiesValue >= 2000000) {
    apexReasons.push("Imóveis quitados iguais ou superiores a R$ 2 milhões");
  }
  if (hasValidFinancialValue(lastContribution) && lastContribution >= 30000) {
    apexReasons.push("Último aporte igual ou superior a R$ 30 mil");
  }
  if (hasValidFinancialValue(liquidityReserve) && liquidityReserve >= 500000) {
    apexReasons.push("Reserva de liquidez igual ou superior a R$ 500 mil");
  }
  if (apexReasons.length) return build("APEX", apexReasons, "high");

  if (hasValidMonthlyIncome) {
    const confidence = debtDataAvailable ? "high" : "medium";
    if (monthlyIncome > 50000) return build("PRIVATE", ["Renda mensal superior a R$ 50 mil"], confidence);
    if (monthlyIncome >= 20000) return build("PRINCIPAL", ["Renda mensal entre R$ 20 mil e R$ 50 mil"], confidence);
    return build("OVER", ["Renda mensal inferior a R$ 20 mil"], confidence);
  }

  return {
    segment: null,
    segmentLabel: INSUFFICIENT_SEGMENT_LABEL,
    segmentStatus: "insufficient_data",
    segmentConfidence: "low",
    segmentReason: "Renda mensal não informada e nenhum critério APEX ou dívida confirmada.",
    segmentReasons: ["Renda mensal não informada e nenhum critério APEX ou dívida confirmada."],
    segmentInputs,
    missingFinancialData,
    segmentWarnings,
  };
}
