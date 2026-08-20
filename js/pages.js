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
    description: "Síntese da carteira e dos sinais mais relevantes para decisão.",
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
    eyebrow: "Jornada",
    description: "Acesso, recência e frequência de uso da plataforma.",
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
  },
  {
    id: "statistical_crosses",
    hash: "statistical-crosses",
    aliases: ["statistical_crosses", "sc", "analises-estatisticas", "analises", "crossings", "exploration"],
    group: "intelligence",
    navLabel: "Análises Estatísticas",
    title: "Análises Estatísticas",
    eyebrow: "Inteligência",
    description: "Associações, sobrevivência e descobertas da carteira. A metodologia completa será migrada nesta página.",
  },
  {
    id: "quality",
    hash: "quality",
    aliases: ["qualidade"],
    group: "system",
    navLabel: "Qualidade dos Dados",
    title: "Qualidade dos Dados",
    eyebrow: "Sistema",
    description: "Completude, lacunas e impacto analítico das bases.",
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
