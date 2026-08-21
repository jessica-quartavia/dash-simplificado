/**
 * Registry estático de insights — Análises Estatísticas.
 * Snapshot editorial 21/08/2026. Não recalcular a partir do payload live.
 */
export const STATISTICAL_INSIGHTS_SNAPSHOT_DATE = "21/08/2026";

export const STATISTICAL_METHODOLOGY_NOTE =
  "Correlação e associação não implicam causalidade. Variáveis com baixa cobertura ou amostra pequena devem ser interpretadas como indícios.";

export const STATISTICAL_METHODOLOGY_DETAILS = [
  "Associações observadas descrevem co-ocorrência ou diferença de medianas no recorte filtrado.",
  "Magnitude estatística não substitui validação operacional ou experimento.",
  "Cobertura mínima e amostra mínima da página filtram variáveis nas matrizes — os textos aqui são fixos.",
  "Cancelamento efetivado segue helper analítico oficial (churn, distrato ou data_churn).",
];

export const STATISTICAL_INSIGHTS_SNAPSHOT_FOOTNOTE =
  `Insights estáticos gerados a partir do snapshot de ${STATISTICAL_INSIGHTS_SNAPSHOT_DATE}. Os indicadores do dashboard podem evoluir conforme a base é atualizada.`;

export const STATISTICAL_INSIGHTS = [
  {
    sectionId: "executive_reading_sample",
    targetSectionId: "scSecExecutiveReading",
    title: "Qualidade da amostra",
    insight:
      "A base analítica é ampla o suficiente para comparações descritivas, mas variáveis-chave como NPS e mecanismos têm cobertura parcial e exigem leitura cautelosa.",
    evidence: [
      "Clientes analisados: 3.391",
      "Ativos: 1.721 · Cancelados efetivados: 78",
      "Cobertura média das variáveis: 62,4%",
      "Respostas NPS válidas: 11,6% da carteira",
      "Mecanismos implementados: 18,7% com registro utilizável",
    ],
    interpretation:
      "O recorte consolida clientes ativos e cancelados com regras analíticas oficiais. Indicadores de satisfação e execução patrimonial não alcançam todos os clientes; associações envolvendo NPS ou mecanismos refletem subpopulações menores.",
    action:
      "Priorizar leituras com cobertura ≥ 30% e amostra mínima por grupo antes de tomar decisões operacionais.",
    limitations: [
      "Congelados e outros status ficam fora de comparações de churn quando aplicável.",
      "Snapshot fixo; filtros do dashboard podem alterar população sem alterar estes textos.",
    ],
  },
  {
    sectionId: "executive_reading_findings",
    targetSectionId: "scSecExecutiveReading",
    title: "Principais descobertas",
    insight:
      "Os sinais mais fortes apontam para relacionamento e cadência de acompanhamento como fatores centrais associados ao cancelamento.",
    evidence: [
      "Reuniões totais e dias desde última reunião aparecem entre os maiores deltas ativo × cancelado.",
      "Primeira reunião realizada concentra diferença relevante entre grupos.",
      "Implementação de mecanismos e atualização financeira também diferenciam perfis, com cobertura desigual.",
    ],
    interpretation:
      "Padrões de contato e marcos de jornada antecedem ou acompanham cancelamentos observados; magnitude estatística não prova causalidade.",
    action:
      "Tratar cadência de reuniões e marcos iniciais como hipóteses operacionais prioritárias para acompanhamento de risco.",
    limitations: [
      "Descobertas automáticas da página usam regras distintas deste texto estático.",
      "Combinações multivariadas podem atenuar efeitos individuais.",
    ],
  },
  {
    sectionId: "scSecCancel",
    targetSectionId: "scSecCancel",
    title: "Cancelamento",
    insight:
      "Cancelamentos concentram-se em clientes com menor frequência de reuniões, maior tempo sem contato e menor progresso nos marcos iniciais da jornada.",
    evidence: [
      "Mediana de reuniões: cancelados abaixo dos ativos no recorte analisado.",
      "Dias desde última reunião: mediana maior entre cancelados.",
      "Primeira reunião realizada: proporção menor entre cancelados.",
      "Variáveis de permanência e ciclo reforçam separação entre grupos.",
    ],
    interpretation:
      "O eixo relacional e de execução da jornada domina as associações observadas com churn efetivado.",
    action:
      "Monitorar clientes ativos com queda de cadência ou atraso em marcos iniciais antes de sinais tardios de insatisfação.",
    limitations: [
      "Cancelamento confirmado via helper analítico oficial; datas ausentes reduzem precisão temporal.",
      "Associações categóricas podem refletir composição de carteira por EP ou programa.",
    ],
  },
  {
    sectionId: "scSecNps",
    targetSectionId: "scSecNps",
    title: "NPS",
    insight:
      "NPS apresenta associações interpretáveis, porém com cobertura baixa (11,6%); usar como complemento, não como eixo principal de risco.",
    evidence: [
      "Respostas NPS válidas: 11,6% dos clientes no snapshot.",
      "Promotores, neutros e detratores distribuem taxas distintas de cancelamento no recorte.",
      "Correlações com permanência e renovação existem, mas com amostra reduzida.",
    ],
    interpretation:
      "Satisfação medida por NPS ajuda a contextualizar casos, mas não representa a maioria da carteira neste recorte.",
    action:
      "Cruzar NPS com sinais de jornada (reuniões, implementação) quando houver resposta; evitar decisões só com base em NPS isolado.",
    limitations: [
      "Última resposta por cliente no trimestre/recorte aplicável na página de satisfação.",
      "Detratores são minoria absoluta; percentuais podem oscilar com poucos casos.",
    ],
  },
  {
    sectionId: "scSecRenewal",
    targetSectionId: "scSecRenewal",
    title: "Renovação",
    insight:
      "Renovação correlaciona-se mais com permanência, ciclo e engajamento recorrente do que com picos pontuais de satisfação.",
    evidence: [
      "Clientes renovados (ciclo > 1): 202 no snapshot.",
      "Variáveis de tempo de casa e reuniões aparecem no ranking de associação com renovação.",
      "NPS e mecanismos entram com cobertura parcial.",
    ],
    interpretation:
      "Renovação inferida por ciclo reflete continuidade contratual e hábito de uso, não evento formal de renovação.",
    action:
      "Analisar renovação junto à permanência e cadência de contato, não apenas último NPS.",
    limitations: [
      "Ciclo inválido ou ausente exclui clientes de análises de renovação.",
      "Proxy de ciclo pode subestimar renovações não registradas na base.",
    ],
  },
  {
    sectionId: "scSecTenure",
    targetSectionId: "scSecTenure",
    title: "Permanência",
    insight:
      "Maior permanência associa-se a clientes com cadência estável de reuniões e marcos de implementação cumpridos.",
    evidence: [
      "Correlações de Spearman positivas entre permanência e volume de reuniões no recorte.",
      "Faixas longas de permanência concentram menor taxa de cancelamento relativa.",
      "Ajuste +365 dias para ciclo ≥ 2 aplicado nas comparações descritivas.",
    ],
    interpretation:
      "Tempo de casa captura efeito acumulado de execução; clientes recentes permanecem mais sensíveis a falhas de onboarding.",
    action:
      "Proteger primeiros 90–180 dias com marcos claros de reunião e implementação.",
    limitations: [
      "Permanência cronológica difere do ajuste analítico usado em algumas matrizes.",
      "Sobrevivência e coorte usam regras temporais próprias.",
    ],
  },
  {
    sectionId: "scSecGroups",
    targetSectionId: "scSecGroups",
    title: "Matriz de grupos",
    insight:
      "Grupos com pior desempenho relativo combinam baixa cadência de reuniões e menor avanço em mecanismos, não apenas perfil financeiro.",
    evidence: [
      "Matriz comparativa destaca desvios padronizados em reuniões e implementação versus referência geral.",
      "Segmentos financeiros isolados explicam parte, mas não toda a variância entre grupos.",
      "Programa Pharus e Davos exibem padrões distintos de cobertura.",
    ],
    interpretation:
      "Comparação entre grupos resume múltiplas dimensões; valores padronizados facilitam leitura relativa, não absoluta.",
    action:
      "Investigar grupos com desvio negativo simultâneo em reuniões e implementação antes de atributos só financeiros.",
    limitations: [
      "Heatmap usa referência geral do recorte filtrado.",
      "Grupos pequenos amplificam desvios aparentes.",
    ],
  },
  {
    sectionId: "scSecCohort",
    targetSectionId: "scSecCohort",
    title: "Coorte e retenção",
    insight:
      "Coortes recentes mostram queda de retenção nas primeiras janelas quando marcos iniciais atrasam; retenção melhora após estabilização de cadência.",
    evidence: [
      "Retenção mês a mês declina mais acentuadamente nas primeiras colunas de vida em coortes recentes.",
      "Cores mais quentes nas primeiras idades indicam maior perda relativa no snapshot.",
      "Sobrevivência global reforça diferença entre curvas por segmento quando comparável.",
    ],
    interpretation:
      "Coorte mede permanência sem cancelamento até idade; não confundir com conversão de funil comercial.",
    action:
      "Acompanhar coortes novas com metas explícitas de primeira reunião e implementação nos primeiros meses.",
    limitations: [
      "Granularidade mensal/trimestral altera leitura fina.",
      "Cancelamentos sem data confirmada reduzem precisão de evento.",
    ],
  },
  {
    sectionId: "scSecGeneralMatrix",
    targetSectionId: "scSecGeneralMatrix",
    title: "Matriz geral e relações entre variáveis",
    insight:
      "A matriz geral confirma cluster de variáveis de jornada (reuniões, implementação, recência) parcialmente independentes de variáveis financeiras.",
    evidence: [
      "Correlações fortes intra-bloco jornada versus correlações moderadas jornada × financeiro.",
      "NPS e mecanismos correlacionam entre si, mas com lacunas de cobertura.",
      "Variáveis de leakage excluídas do ranking preditivo.",
    ],
    interpretation:
      "Relações pairwise não substituem modelo multivariável; matriz é mapa exploratório.",
    action:
      "Usar matriz para hipóteses de combinação, não para priorização automática de ações.",
    limitations: [
      "Correlação linear/monotônica pode omitir efeitos não lineares.",
      "Missing data reduz pares comparáveis.",
    ],
  },
  {
    sectionId: "scSecPredict",
    targetSectionId: "scSecPredict",
    title: "Variáveis excluídas e cuidados de leakage",
    insight:
      "Variáveis pós-cancelamento ou derivadas do próprio desfecho foram excluídas; ranking preditivo deve ignorar indicadores com risco de leakage.",
    evidence: [
      "Lista de excluídas inclui status analítico tardio, datas pós-churn e proxies circulares.",
      "AUC > 0,80 dispara revisão de leakage no ranking exploratório.",
      "currentCycle e renewalCount não entram como explicativas do próprio desfecho de renovação.",
    ],
    interpretation:
      "Exclusões protegem interpretação causal, mas reduzem universo de variáveis “fortes” artificialmente.",
    action:
      "Validar manualmente qualquer variável nova antes de incluí-la no ranking preditivo.",
    limitations: [
      "Regras de exclusão evoluem com novos campos na base.",
      "Modelo exploratório multivariável permanece amostral e não calibrado para produção.",
    ],
  },
];

export const EXECUTIVE_RECOMMENDATIONS = [
  "Priorizar cadência de reuniões e redução de tempo sem contato nos clientes ativos.",
  "Garantir realização da primeira reunião e marcos iniciais de implementação nos primeiros meses.",
  "Monitorar combinações de baixa reunião + baixa implementação como perfil de risco relativo.",
  "Usar NPS e mecanismos como complemento, respeitando cobertura parcial (11,6% e 18,7%).",
  "Revisar coortes recentes com queda precoce de retenção antes de atribuir causas financeiras.",
  "Tratar ranking preditivo como triagem exploratória, não score operacional definitivo.",
  "Documentar ações tomadas separadamente dos achados estatísticos para evitar confundir associação com impacto.",
];

export const STATISTICAL_PAGE_CONCLUSION =
  "O principal eixo de risco observado associa-se mais à execução da jornada — primeira reunião, frequência de reuniões, tempo sem contato e implementação — do que a indicadores pontuais de satisfação ou mecanismos isolados. NPS e mecanismos devem ser interpretados com cautela pela cobertura menor no recorte analisado.";

export const STATISTICAL_INSIGHT_PLACEMENTS = [
  { blockId: "scSecExecutiveReading", insightIds: ["executive_reading_sample", "executive_reading_findings"] },
  { blockId: "scSecCancel", insightIds: ["scSecCancel"] },
  { blockId: "scSecNps", insightIds: ["scSecNps"] },
  { blockId: "scSecRenewal", insightIds: ["scSecRenewal"] },
  { blockId: "scSecTenure", insightIds: ["scSecTenure"] },
  { blockId: "scSecGroups", insightIds: ["scSecGroups"] },
  { blockId: "scSecCohort", insightIds: ["scSecCohort"] },
  { blockId: "scSecGeneralMatrix", insightIds: ["scSecGeneralMatrix"] },
  { blockId: "scSecPredict", insightIds: ["scSecPredict"] },
];

const insightById = new Map(STATISTICAL_INSIGHTS.map((item) => [item.sectionId, item]));

export function getStatisticalInsight(sectionId) {
  return insightById.get(sectionId) || null;
}

export function getInsightsForBlock(blockId) {
  const placement = STATISTICAL_INSIGHT_PLACEMENTS.find((p) => p.blockId === blockId);
  if (!placement) return [];
  return placement.insightIds.map((id) => insightById.get(id)).filter(Boolean);
}

export function listRequiredInsightSectionIds() {
  return STATISTICAL_INSIGHTS.map((item) => item.sectionId);
}
