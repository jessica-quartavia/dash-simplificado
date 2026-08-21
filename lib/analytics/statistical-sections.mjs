/**
 * Registry declarativo — ordem V1 da página Análises Estatísticas.
 * Fonte de verdade para sequência de seções (não alterar sem revisar paridade V1).
 */
export const STATISTICAL_SECTIONS = [
  { order: 1, id: "scSecResumo", title: "Resumo da base analítica", type: "kpi" },
  { order: 2, id: "scSecDiscoveries", title: "Principais descobertas", type: "ranking" },
  { order: 3, id: "scSecCancel", title: "Cancelamento — correlações e associações", type: "matrix" },
  { order: 4, id: "scSecNps", title: "NPS — matriz de correlação", type: "matrix" },
  { order: 5, id: "scSecRenewal", title: "Renovação — matriz de associação", type: "matrix" },
  { order: 6, id: "scSecTenure", title: "Permanência — matriz de correlação", type: "matrix" },
  { order: 7, id: "scSecGroups", title: "Matriz comparativa dos grupos", type: "heatmap" },
  { order: 8, id: "scSecPredict", title: "Ranking preditivo de cancelamento", type: "ranking" },
  { order: 9, id: "scSecRules", title: "Combinações de fatores", type: "table" },
  { order: 10, id: "scSecSurvival", title: "Curva de sobrevivência", type: "survival curve" },
  { order: 11, id: "scSecCohort", title: "Análise de cohort", type: "cohort" },
  { order: 12, id: "scSecGeneralMatrix", title: "Matriz geral de relações entre variáveis", type: "heatmap" },
  { order: 13, id: "scSecSignals", title: "Clientes ativos com sinais detectados", type: "table" },
  { order: 14, id: "scSecTop", title: "Top clientes — Pharus e Davos", type: "ranking" },
  { order: 15, id: "scSecNpsMatrix", title: "Matriz comparativa NPS (variáveis amplas)", type: "heatmap" },
  { order: 16, id: "scSecExcluded", title: "Variáveis excluídas", type: "table" },
  { order: 17, id: "scSecQuality", title: "Qualidade, cobertura e limitações", type: "bloco metodológico" },
];

export { STATISTICAL_SECTIONS_REGISTRY } from "./statistical-sections-registry.mjs";
