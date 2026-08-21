/**
 * Registry declarativo — ordem real V1 (#view-statistical-crosses).
 * Usado para testes de paridade e documentação; não substitui render dinâmico.
 */
export const STATISTICAL_SECTIONS_REGISTRY = [
  { order: 1, id: "scSecResumo", title: "1. Resumo da base analítica", type: "kpi", hasDetailsTable: false, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 2, id: "scSecDiscoveries", title: "2. Principais descobertas", type: "ranking", hasDetailsTable: false, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 3, id: "scSecCancel", title: "3. Cancelamento — correlações e associações", type: "matrix", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 4, id: "scSecNps", title: "4. NPS — matriz de correlação", type: "matrix", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 5, id: "scSecRenewal", title: "5. Renovação — matriz de associação", type: "matrix", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 6, id: "scSecTenure", title: "6. Permanência — matriz de correlação", type: "matrix", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 7, id: "scSecGroups", title: "7. Matriz comparativa dos grupos", type: "heatmap", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 8, id: "scSecPredict", title: "8. Ranking preditivo de cancelamento", type: "ranking", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 9, id: "scSecRules", title: "9. Combinações de fatores", type: "table", hasDetailsTable: false, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 10, id: "scSecSurvival", title: "10. Curva de sobrevivência", type: "survival curve", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 11, id: "scSecCohort", title: "11. Análise de cohort", type: "cohort", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period", "cohortPeriod", "cohortGranularity"] },
  { order: 12, id: "scSecGeneralMatrix", title: "12. Matriz geral de relações entre variáveis", type: "heatmap", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 13, id: "scSecSignals", title: "Clientes ativos com sinais detectados", type: "table", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 14, id: "scSecTop", title: "Top clientes — Pharus e Davos", type: "ranking", hasDetailsTable: true, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 15, id: "scSecNpsMatrix", title: "Matriz comparativa NPS (variáveis amplas)", type: "heatmap", hasDetailsTable: false, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 16, id: "scSecExcluded", title: "13. Variáveis excluídas", type: "table", hasDetailsTable: false, filters: ["search", "engineer", "status", "program", "period"] },
  { order: 17, id: "scSecQuality", title: "14. Qualidade, cobertura e limitações", type: "bloco metodológico", hasDetailsTable: false, filters: [] },
];

/** Bloco compacto no topo (substitui alerta interpretativo V2). */
export const STATISTICAL_HEALTH_SCORE_BLOCK = {
  id: "scSecHealthCandidates",
  title: "Variáveis mais relevantes para Health Score",
  type: "candidatos",
};

export const STATISTICAL_CANCEL_SUBSECTIONS = [
  "Matriz de associação com cancelamento",
  "Diferença entre ativos e cancelados",
  "Poder preditivo individual (AUC)",
  "Associações numéricas com cancelamentos",
  "Associações categóricas com cancelamentos",
  "Ranking de associações com cancelamento",
];
