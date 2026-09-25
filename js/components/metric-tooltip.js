/**
 * Tooltip acessível para métricas técnicas (hover + focus).
 */
import { escapeHtml } from "../general-charts.mjs";

export function renderMetricTooltip(label, tipText, options = {}) {
  const id = options.id || `mt-${Math.random().toString(36).slice(2, 9)}`;
  const tip = escapeHtml(tipText || "");
  const lbl = escapeHtml(label || "");
  return `<span class="metric-tooltip-wrap">
  <span class="metric-tooltip-label">${lbl}</span>
  <button type="button" class="metric-tooltip-trigger" aria-describedby="${id}" aria-label="Explicação: ${lbl}">?</button>
  <span class="metric-tooltip-panel" id="${id}" role="tooltip">${tip}</span>
</span>`;
}

export function bindMetricTooltips(root = document) {
  const triggers = root.querySelectorAll(".metric-tooltip-trigger");
  for (const btn of triggers) {
    if (btn.dataset.bound === "1") continue;
    btn.dataset.bound = "1";
    const panelId = btn.getAttribute("aria-describedby");
    const panel = panelId ? document.getElementById(panelId) : btn.nextElementSibling;
    if (!panel) continue;
    const show = () => panel.classList.add("is-visible");
    const hide = () => panel.classList.remove("is-visible");
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("mouseleave", hide);
    btn.addEventListener("focus", show);
    btn.addEventListener("blur", hide);
  }
}

export const METRIC_TOOLTIPS = Object.freeze({
  accuracy:
    "Percentual total de classificações corretas. Pode parecer alta mesmo quando o modelo quase sempre escolhe a classe mais comum.",
  baselineAccuracy: "Resultado de uma regra simples usada como comparação.",
  balancedAccuracy: "Equilibra o acerto dos renovados e dos não renovados.",
  precision: "Dos clientes que o modelo marcou como renovação, quantos realmente renovaram.",
  recall: "De todos os clientes que realmente renovaram, quantos o modelo conseguiu identificar.",
  f1: "Equilibra Precision e Recall.",
  rocAuc:
    "Mostra se o modelo consegue colocar clientes que renovam acima dos que não renovam. 50% seria próximo do acaso; quanto maior, melhor a separação.",
  prAuc: "Dá mais atenção à capacidade de encontrar os casos de renovação, que são menos frequentes.",
  brier: "Mede o erro das probabilidades. Quanto menor, melhor.",
  baselineBrier: "Erro esperado se todas as probabilidades fossem iguais à taxa base.",
  tp: "Previu renovação e houve renovação.",
  fp: "Previu renovação, mas não houve.",
  tn: "Previu ausência de renovação e não houve renovação.",
  fn: "Previu ausência de renovação, mas houve renovação.",
  trainSplit:
    "Treino é a parte usada para o modelo aprender. Teste é uma parte separada usada para verificar se ele funciona em clientes que não participaram do aprendizado.",
  eraCutoff:
    "O corte define a partir de qual período consideramos que os clientes tiveram uma oportunidade mais comparável de receber mecanismos.",
  expectedRate: "Média das probabilidades individuais.",
  expectedRenewals: "Soma das probabilidades dos clientes.",
  projectionBand: "Intervalo aproximado para comunicar a incerteza da estimativa.",
  proxyCycleEnd:
    "Usamos data_fim_ciclo como aproximação da janela de renovação, porque não existe uma data oficial de renovação.",
  conservativeBrier: "A amostra menor deixou as probabilidades mais instáveis.",
  shrinkage: "Evita confiar demais em grupos com poucos clientes.",
  probabilityClip: "Evita que o modelo diga que uma renovação é impossível ou garantida.",
  minStratum:
    "O modelo só usa a taxa específica de um grupo quando há clientes suficientes para não confiar em uma amostra muito pequena.",
  specificity: "Entre os que não renovaram, quantos o modelo acertou.",
  association: "Relação observada no histórico — não prova que o mecanismo causou a renovação.",
});
