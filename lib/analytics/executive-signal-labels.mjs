/**
 * Rótulos amigáveis para sinais no Resumo Executivo — sem alterar o dataset fonte.
 */
export const EXECUTIVE_SIGNAL_DISPLAY_LABELS = Object.freeze({
  login_drop: "Queda de logins",
  no_meeting_60: "Muitos dias desde a última reunião",
  no_implementation_90: "Sem mecanismo implementado",
  no_financial_60: "Sem atualização financeira recente",
  nps_detractor: "NPS detrator recente",
  inactive_30: "Baixa interação recente",
});

export function executiveSignalDisplayLabel(signal = {}) {
  const key = signal.key || signal.id;
  if (key && EXECUTIVE_SIGNAL_DISPLAY_LABELS[key]) return EXECUTIVE_SIGNAL_DISPLAY_LABELS[key];
  return signal.label || "—";
}

export function executiveSignalDistributionLabel(label = "") {
  const text = String(label || "").trim();
  if (!text) return text;
  if (/sinal de atrito/i.test(text)) return text;
  if (text === "4 ou mais sinais") return "4 ou mais sinais de atrito";
  if (/^(\d+) sinal$/.test(text)) return text.replace(/^(\d+) sinal$/, "$1 sinal de atrito");
  if (/^(\d+) sinais$/.test(text)) return text.replace(/^(\d+) sinais$/, "$1 sinais de atrito");
  return text;
}
