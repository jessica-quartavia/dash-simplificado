/**
 * Páginas ativas do portal V2.
 * IDs canônicos preservados da V1 para a migração de conteúdo.
 *
 * Kernel analítico (status, exclusões, permanência, ciclo, active-first)
 * será um módulo único em lib/ na próxima etapa — não duplicar regras aqui.
 */

export const DEFAULT_PAGE_ID = "executive_summary";

export const PAGE_GROUPS = [
  { id: "overview", label: "Visão geral" },
  { id: "journey", label: "Jornada" },
  { id: "retention", label: "Retenção" },
  { id: "management", label: "Gestão" },
  { id: "intelligence", label: "Inteligência" },
  { id: "system", label: "Sistema" },
];

export const PAGES = [
  {
    id: "executive_summary",
    hash: "executive",
    aliases: ["executive_summary", "resumo"],
    group: "overview",
    navLabel: "Resumo Executivo",
    title: "Resumo Executivo",
    eyebrow: "Visão geral",
    description: "Visão consolidada dos principais indicadores da jornada do cliente.",
    implemented: true,
  },
  {
    id: "general",
    hash: "general",
    aliases: ["dados-gerais"],
    group: "overview",
    navLabel: "Dados Gerais",
    title: "Dados Gerais",
    eyebrow: "Visão geral",
    description: "Composição da carteira, perfil cadastral e indicadores financeiros. Abre em clientes ativos.",
    implemented: true,
  },
  {
    id: "reports",
    hash: "reports",
    aliases: ["relatorios", "relatórios"],
    group: "overview",
    navLabel: "Relatórios",
    title: "Relatórios",
    eyebrow: "Visão geral",
    description: "Relatórios e análises publicados pelo time de Inteligência da QuartaVia.",
    implemented: true,
  },
  {
    id: "journey",
    hash: "journey",
    aliases: ["onboarding", "jornada"],
    group: "journey",
    navLabel: "Jornada e Onboarding",
    title: "Jornada e Onboarding",
    titleSuffix: "🔧",
    isUnderConstruction: true,
    constructionNotice: "Dashboard em construção",
    eyebrow: "Jornada",
    description: "Conclusão e tempo da jornada inicial. Abre em clientes ativos.",
    implemented: true,
  },
  {
    id: "meetings",
    hash: "meetings",
    aliases: ["reunioes"],
    group: "journey",
    navLabel: "Reuniões",
    title: "Reuniões",
    eyebrow: "Jornada",
    description: "Cobertura, cadência e comparecimento das reuniões. Abre em clientes ativos.",
    implemented: true,
  },
  {
    id: "patrimonial_plan",
    hash: "plan",
    aliases: ["patrimonial_plan", "plano"],
    group: "journey",
    navLabel: "Plano Patrimonial",
    title: "Plano Patrimonial",
    titleSuffix: "🔧",
    isUnderConstruction: true,
    constructionNotice: "Dashboard em construção",
    eyebrow: "Jornada",
    description: "Tempo médio até a aprovação do plano. Métrica histórica da carteira.",
    implemented: true,
  },
  {
    id: "mechanisms",
    hash: "mechanisms",
    aliases: ["mecanismos"],
    group: "journey",
    navLabel: "Implementação de Mecanismos",
    title: "Implementação de Mecanismos",
    eyebrow: "Jornada",
    description: "Cobertura e implementação de mecanismos na BASE QV. Abre em clientes ativos.",
    implemented: true,
  },
  {
    id: "platform_usage",
    hash: "platform",
    aliases: ["platform_usage", "plataforma"],
    group: "journey",
    navLabel: "Uso da Plataforma",
    title: "Uso da Plataforma",
    titleSuffix: "🔧",
    isUnderConstruction: true,
    constructionNotice: "Este dashboard está em construção e pode passar por ajustes durante a validação.",
    eyebrow: "Jornada",
    description: "Acesso, recência e frequência de uso da plataforma.",
    implemented: true,
  },
  {
    id: "financial_updates",
    hash: "financial",
    aliases: ["financial_updates", "financeiro"],
    group: "journey",
    navLabel: "Atualização Financeira",
    title: "Atualização Financeira",
    eyebrow: "Jornada",
    description: "Cobertura e recência das atualizações financeiras.",
    implemented: true,
  },
  {
    id: "support",
    hash: "support",
    aliases: ["acionamentos", "atendimento"],
    group: "journey",
    navLabel: "Acionamentos",
    title: "Acionamentos",
    eyebrow: "Jornada",
    description: "Volume, temas e andamento dos acionamentos.",
    implemented: true,
  },
  {
    id: "satisfaction",
    hash: "satisfaction",
    aliases: ["satisfacao", "nps"],
    group: "journey",
    navLabel: "Pesquisa de Satisfação",
    title: "Pesquisa de Satisfação",
    eyebrow: "Jornada",
    description: "NPS, CSAT e cobertura da pesquisa junto aos clientes.",
    implemented: true,
  },
  {
    id: "cancellations",
    hash: "cancellations",
    aliases: ["cancelamento"],
    group: "retention",
    navLabel: "Cancelamento",
    title: "Cancelamento",
    eyebrow: "Retenção",
    description: "Processo, motivos e churn confirmado.",
    implemented: true,
  },
  {
    id: "renewal",
    hash: "renewal",
    aliases: ["renovacao"],
    group: "retention",
    navLabel: "Renovação",
    title: "Renovação",
    eyebrow: "Retenção",
    description: "Elegíveis, renovação e ciclos da carteira.",
    implemented: true,
  },
  {
    id: "ep_performance",
    hash: "ep",
    aliases: ["ep_performance", "performance-ep"],
    group: "management",
    navLabel: "Performance do Engenheiro Patrimonial",
    title: "Performance do Engenheiro Patrimonial",
    eyebrow: "Gestão",
    description: "Cobertura e sinais por carteira de engenheiro patrimonial.",
    implemented: true,
  },
  {
    id: "temporal_indicators",
    hash: "temporal",
    aliases: ["temporal_indicators", "indicadores-temporais"],
    group: "intelligence",
    navLabel: "Indicadores Temporais",
    title: "Indicadores Temporais",
    eyebrow: "Inteligência",
    description: "Mudanças recentes, recência e sinais de atenção.",
    implemented: true,
  },
  {
    id: "statistical_crosses",
    hash: "statistical-crosses",
    aliases: ["statistical_crosses", "sc", "analises-estatisticas", "analises", "crossings", "exploration"],
    group: "intelligence",
    navLabel: "Análises Estatísticas",
    title: "Análises Estatísticas",
    eyebrow: "Inteligência",
    description: "Associações, sobrevivência e descobertas da carteira.",
    implemented: true,
  },
  {
    id: "health_score",
    hash: "health-score",
    aliases: ["health_score", "health", "score-saude"],
    group: "intelligence",
    navLabel: "Health Score",
    title: "Health Score",
    eyebrow: "Inteligência",
    description: "Classificação experimental de saúde do cliente com reuniões e mecanismos.",
    implemented: true,
  },
  {
    id: "quality",
    hash: "quality",
    aliases: ["qualidade"],
    group: "system",
    navLabel: "Qualidade dos Dados",
    title: "Qualidade dos Dados",
    eyebrow: "Sistema",
    description:
      "Esta página é utilizada pelo time de Inteligência para analisar cobertura, disponibilidade e confiabilidade dos dados utilizados no portal — identificar lacunas de preenchimento, entender cobertura e apoiar priorização de melhorias.",
    implemented: true,
  },
  {
    id: "metrics_documentation",
    hash: "metrics-documentation",
    aliases: ["metrics_documentation", "documentacao-de-metricas", "documentacao-metricas"],
    group: "system",
    navLabel: "Documentação de Métricas",
    title: "Documentação de Métricas",
    eyebrow: "Sistema",
    description: "Veja de forma simples como os números do Analytics são calculados e o que cada indicador quer dizer.",
    icon: "book-open",
    implemented: true,
  },
  {
    id: "access_management",
    hash: "access",
    aliases: ["acessos", "gerenciamento-acessos", "access_management"],
    group: "system",
    navLabel: "Gerenciamento de Acessos",
    title: "Gerenciamento de Acessos",
    eyebrow: "Sistema",
    description: "Cadastro de usuários, times e permissões do Analytics QuartaVia.",
    implemented: true,
  },
];

const pagesById = new Map(PAGES.map((page) => [page.id, page]));
const pagesByHash = new Map();

for (const page of PAGES) {
  pagesByHash.set(page.hash.toLowerCase(), page);
  pagesByHash.set(page.id.toLowerCase(), page);
  for (const alias of page.aliases || []) {
    pagesByHash.set(String(alias).toLowerCase(), page);
  }
}

export function getPageById(id) {
  return pagesById.get(id) || null;
}

export function isPageImplemented(pageOrId) {
  const id = typeof pageOrId === "string" ? pageOrId : pageOrId?.id;
  return Boolean(getPageById(id)?.implemented);
}

export function resolvePageFromHash(rawHash) {
  const key = String(rawHash || "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();
  if (!key) return getPageById(DEFAULT_PAGE_ID);
  return pagesByHash.get(key) || getPageById(DEFAULT_PAGE_ID);
}

export function getPagesByGroup(groupId) {
  return PAGES.filter((page) => page.group === groupId);
}
