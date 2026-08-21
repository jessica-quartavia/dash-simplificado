/**
 * Matrizes de viabilidade da página Qualidade (port V1 renderQualityMatrices).
 */

const fmt = new Intl.NumberFormat("pt-BR");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function fixedCoverage(count, total, percent) {
  return { count: count || 0, total: total || 0, percent: percent || 0 };
}

function viabilityClass(value) {
  if (value === "Sem dado" || value === "Sem dados" || value === "Não identificado") return "no";
  if (String(value).startsWith("Parcial")) return "base";
  return "sim";
}

function coverageText(item) {
  return item?.total
    ? `${fmt.format(item.count || 0)} / ${fmt.format(item.total)}<span>${pctLabel(item.percent || 0)}</span>`
    : "Sem dado";
}

export function renderViabilityMatrixHtml(rows = []) {
  const head = `<div class="indicator-row"><div class="indicator-cell indicator-head">Indicador</div><div class="indicator-cell indicator-head">Viabilidade</div><div class="indicator-cell indicator-head">Cobertura</div><div class="indicator-cell indicator-head">Fonte / cálculo</div><div class="indicator-cell indicator-head">Base</div></div>`;
  const body = (rows || [])
    .map(
      (item) => `<div class="indicator-row"><div class="indicator-cell">${escapeHtml(item.indicator)}</div><div class="indicator-cell indicator-status ${viabilityClass(item.viability)}">${escapeHtml(item.viability)}</div><div class="indicator-cell indicator-coverage">${coverageText(item.coverage)}</div><div class="indicator-cell">${escapeHtml(item.metric)}</div><div class="indicator-cell">${escapeHtml(item.base || "public")}</div></div>`,
    )
    .join("");
  return head + body;
}

function indicatorRowsFromPayload(payload, fallback, base) {
  const indicators = payload?.indicators || [];
  if (!indicators.length) {
    return fallback.map((item) => ({ ...item, coverage: fixedCoverage(0, 0, 0), base: item.base || base }));
  }
  return indicators.map((item) => ({
    indicator: item.indicator,
    viability: item.viability || "Sim",
    metric: item.metric || item.calculation || base,
    coverage:
      item.coverage && typeof item.coverage === "object"
        ? fixedCoverage(item.coverage.count ?? item.coverage.value, item.coverage.total, item.coverage.percent)
        : fixedCoverage(item.value, item.total, item.coverage),
    base: item.base || base,
  }));
}

function supportFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function coverageOf(rows, predicate) {
  const count = rows.filter(predicate).length;
  return fixedCoverage(count, rows.length, rows.length ? (count / rows.length) * 100 : 0);
}

function supportSummaryFromPayload(support = {}) {
  const tickets = support.tickets || support.rows || [];
  const summary = support.summary || {};
  const totalTickets = summary.totalTickets ?? tickets.length;
  const ticketsWithClient = summary.ticketsWithClient ?? tickets.filter((t) => t.clientIdentified).length;
  const identifiedPercent =
    summary.identifiedPercent ?? summary.identificationCoverage ?? (totalTickets ? (ticketsWithClient / totalTickets) * 100 : 0);
  return {
    totalTickets,
    identifiedClients: summary.identifiedClients ?? ticketsWithClient,
    identifiedPercent,
  };
}

/**
 * @param {Record<string, object>} sources
 * keys: general, onboarding, plan, meetings, mechanisms, financial, satisfaction, temporal, renewal, ep, support, pharus
 */
export function buildQualityViabilitySections(sources = {}) {
  const generalRows = sources.general?.clients || [];
  const meetingRows = sources.meetings?.clients || [];
  const journeySummary = sources.onboarding?.summary || {};
  const planSummary = sources.plan?.summary || {};
  const mechanismsSummary = sources.mechanisms?.summary || {};
  const financialSummary = sources.financial?.summary || {};
  const renewalSummary = sources.renewal?.summary || {};
  const epSummary = sources.ep?.summary || {};
  const pharusSummary = sources.pharus?.summary || {};
  const supportTickets = sources.support?.tickets || sources.support?.rows || [];
  const supportSummary = supportSummaryFromPayload(sources.support);

  const pharusPct = (count, total) => (total ? (count / total) * 100 : 0);

  return [
    {
      id: "general",
      title: "Dados Gerais",
      subtitle: "Indicadores usados na primeira aba",
      rows: [
        { indicator: "ID do cliente", viability: "Sim", metric: "clients.id", coverage: coverageOf(generalRows, (row) => Boolean(row.clientId)), base: "BASE QV" },
        { indicator: "Data de contratação", viability: "Sim", metric: "vw_info_cliente.data_assinatura_contrato; fallback clients.data_inicio_ciclo/created_at", coverage: coverageOf(generalRows, (row) => Boolean(row.contractDate)), base: "BASE QV" },
        { indicator: "Data de cancelamento", viability: "Sim", metric: "cancellations.churn_efetivado_at; fallback clients.data_churn", coverage: coverageOf(generalRows, (row) => Boolean(row.cancellationDate)), base: "BASE QV" },
        { indicator: "Tempo de permanência", viability: "Sim", metric: "Data de cancelamento ou data atual - data de contratação/criação", coverage: coverageOf(generalRows, (row) => row.stayDays != null), base: "BASE QV" },
        { indicator: "Status atual", viability: "Sim", metric: "clients.status normalizado com cancelamentos", coverage: coverageOf(generalRows, (row) => Boolean(row.clientStatus || row.status || row.analyticalStatus)), base: "BASE QV" },
        { indicator: "Segmento do cliente", viability: "Sim", metric: "clients.segmentacao normalizada", coverage: coverageOf(generalRows, (row) => Boolean(row.segment || row.segmentLabel)), base: "BASE QV" },
        { indicator: "Engenheiro Patrimonial responsável", viability: "Sim", metric: "clients.engenheiro_patrimonial", coverage: coverageOf(generalRows, (row) => Boolean(row.engineer)), base: "BASE QV" },
        { indicator: "Perfil financeiro", viability: "Sim", metric: "client_financial_data por client_id", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Última renda mensal", viability: "Sim", metric: "client_financial_data.ultima_renda_mensal", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Último aporte", viability: "Sim", metric: "client_financial_data.ultimo_aporte", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Reserva de liquidez", viability: "Sim", metric: "client_financial_data.reserva_liquidez", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Imóvel, carro e consórcio", viability: "Sim", metric: "client_financial_data.possui_imovel/possui_carro/possui_consorcio", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Evolução mensal da aquisição de clientes", viability: "Sim", metric: "Agrupamento mensal pela data oficial de contratação", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
      ],
    },
    {
      id: "onboarding",
      title: "Jornada e onboarding",
      subtitle: "Indicadores usados na tela de jornada",
      rows: [
        { indicator: "Dias entre contratação e primeira reunião", viability: "Sim", metric: "Coorte cronológica dos três marcos: data inicial → primeira client_meetings.start_time; mediana", coverage: fixedCoverage(journeySummary.firstMeetingCount, journeySummary.totalClients, journeySummary.firstMeetingCoveragePercent), base: "BASE QV" },
        { indicator: "Dias entre contratação e entrega do plano patrimonial", viability: "Parcial", metric: "Mesma coorte: data inicial → primeira reunião Central de Inteligência; mediana e ordem onboarding ≤ reunião ≤ plano", coverage: fixedCoverage(journeySummary.planDeliveryCount, journeySummary.totalClients, journeySummary.planDeliveryCoveragePercent), base: "BASE QV" },
        { indicator: "Dias entre contratação e aprovação do plano", viability: "Parcial", metric: "Mesmo proxy da entrega: contratação → primeira reunião Central de Inteligência; não representa aprovação formal", coverage: fixedCoverage(journeySummary.planApprovalCount, journeySummary.totalClients, journeySummary.planApprovalCoveragePercent), base: "BASE QV" },
        { indicator: "Dias entre contratação e primeiro mecanismo implementado", viability: "Sim", metric: "Data inicial → primeira implementação válida em public.client_mecanismos; prioridade implemented_at, implantado_at ou data_implementacao, com fallback updated_at/created_at para status implementado; negativos excluídos; mediana", coverage: fixedCoverage(journeySummary.firstImplementationCount, journeySummary.totalClients, journeySummary.firstImplementationCoveragePercent), base: "BASE QV" },
        { indicator: "Tempo total de onboarding", viability: "Parcial", metric: "Coorte cronológica dos três marcos: data inicial → primeiro entre primeira reunião e primeira inclusão financeira; mediana", coverage: fixedCoverage(journeySummary.totalOnboardingCount, journeySummary.totalClients, journeySummary.totalOnboardingCoveragePercent), base: "BASE QV" },
        { indicator: "Concluíram Onboarding App Pharus", viability: "Sim", metric: "count(distinct client_id/user_id) em metrics.events com event_name = onboarding_step_completed", coverage: fixedCoverage(journeySummary.appPharusCompletedOnboarding, journeySummary.totalClients, journeySummary.totalClients ? ((journeySummary.appPharusCompletedOnboarding || 0) / journeySummary.totalClients) * 100 : 0), base: "App Pharus" },
        { indicator: "Concluiu onboarding (Sim/Não)", viability: "Sim", metric: "current_stage_id fora da lista de estágios abertos OU primeira reunião OU registro em public.client_financial_data", coverage: fixedCoverage(journeySummary.completedOnboarding, journeySummary.completionBaseClients, journeySummary.completedPercent), base: "BASE QV" },
        { indicator: "Percentual do onboarding concluído", viability: "Sim", metric: "Clientes concluídos por estágio OU primeira reunião OU dados financeiros ÷ clientes com base de conclusão", coverage: fixedCoverage(journeySummary.completedOnboarding, journeySummary.completionBaseClients, journeySummary.completedPercent), base: "BASE QV" },
        { indicator: "Tempo médio para cada etapa da jornada", viability: "Sim", metric: "Mediana entre eventos consecutivos do mesmo cliente em metrics.events, agrupando event_name por resposta do quiz, status financeiro, onboarding e open finance; fallback journey_stages.name", coverage: fixedCoverage(journeySummary.stageDurationCount, journeySummary.totalClients, journeySummary.stageDurationCoveragePercent), base: "App Pharus + BASE QV" },
      ],
    },
    {
      id: "plan",
      title: "Plano Patrimonial",
      subtitle: "Indicadores consolidados das fontes patrimoniais",
      rows: [
        { indicator: "Plano entregue (Sim/Não)", viability: "Parcial", metric: "Proxy: contagem de reuniões cujo client_meetings.event_name contém Central de Inteligência", coverage: fixedCoverage(planSummary.planDelivered, planSummary.totalClients, planSummary.totalClients ? ((planSummary.deliveredClients || 0) / planSummary.totalClients) * 100 : 0), base: "BASE QV" },
        { indicator: "Plano aprovado (Sim/Não)", viability: "Parcial", metric: "Proxy: clientes distintos com reunião Central de Inteligência; não representa aprovação formal", coverage: fixedCoverage(planSummary.planApproved, planSummary.totalClients, planSummary.totalClients ? ((planSummary.planApproved || 0) / planSummary.totalClients) * 100 : 0), base: "BASE QV" },
        { indicator: "Dias até aprovação", viability: "Parcial", metric: "Proxy: última reunião Central de Inteligência - data de contratação; diferenças negativas excluídas", coverage: fixedCoverage(planSummary.daysToApprovalCount, planSummary.totalClients, planSummary.daysToApprovalCoveragePercent), base: "BASE QV" },
        { indicator: "Plano revisado posteriormente?", viability: "Parcial", metric: "Cliente com mais de uma reunião Central de Inteligência", coverage: fixedCoverage(planSummary.revisedLater, planSummary.totalClients, planSummary.totalClients ? ((planSummary.revisedLater || 0) / planSummary.totalClients) * 100 : 0), base: "BASE QV" },
        { indicator: "Quantidade de revisões", viability: "Parcial", metric: "Soma por cliente de reuniões Central de Inteligência menos um", coverage: fixedCoverage(planSummary.revisionsTotal, planSummary.totalClients, planSummary.totalClients ? ((planSummary.revisionsTotal || 0) / planSummary.totalClients) * 100 : 0), base: "BASE QV" },
        { indicator: "Clientes registrados por fonte", viability: "Sim", metric: "Contagem distinta de clients.id na BASE QV", coverage: fixedCoverage(planSummary.totalClients, planSummary.totalClients, planSummary.totalClients ? 100 : 0), base: "BASE QV" },
      ],
    },
    {
      id: "meetings",
      title: "Reuniões",
      subtitle: "Indicadores usados na tela de reuniões",
      rows: [
        { indicator: "Quantidade total de reuniões", viability: "Sim", metric: "client_meetings + manual_meetings por cliente", coverage: coverageOf(meetingRows, (row) => (row.totalMeetings || 0) > 0), base: "BASE QV" },
        { indicator: "Média de reuniões por mês", viability: "Sim", metric: "Total de reuniões / meses desde início", coverage: coverageOf(meetingRows, (row) => row.meetingsPerMonth != null), base: "BASE QV" },
        { indicator: "Dias desde a última reunião", viability: "Sim", metric: "Data atual - última reunião", coverage: coverageOf(meetingRows, (row) => row.daysSinceLastMeeting != null), base: "BASE QV" },
        { indicator: "Intervalo médio entre reuniões", viability: "Sim", metric: "Média dos intervalos entre reuniões do mesmo cliente", coverage: coverageOf(meetingRows, (row) => row.averageIntervalDays != null), base: "BASE QV" },
        { indicator: "Quantidade de faltas do cliente", viability: "Parcial", metric: "meeting_attendance/no-show quando disponível", coverage: coverageOf(meetingRows, (row) => row.absences != null), base: "BASE QV" },
        { indicator: "Quantidade de remarcações", viability: "Parcial", metric: "Registros remarcados em meeting_attendance/client_meetings quando disponível", coverage: coverageOf(meetingRows, (row) => row.reschedules != null), base: "BASE QV" },
        { indicator: "Quantidade de reuniões canceladas", viability: "Parcial", metric: "Status/campo de cancelamento nas fontes de reunião quando disponível", coverage: coverageOf(meetingRows, (row) => row.cancelledMeetings != null), base: "BASE QV" },
        { indicator: "Cliente realizou primeira reunião? (Sim/Não)", viability: "Sim", metric: "Existe ao menos uma reunião realizada/válida por cliente", coverage: coverageOf(meetingRows, (row) => row.firstMeetingCompleted != null), base: "BASE QV" },
      ],
    },
    {
      id: "mechanisms",
      title: "Mecanismos",
      subtitle: "Indicadores usados na tela de mecanismos",
      rows: [
        { indicator: "Quantidade total de mecanismos disponíveis para o cliente", viability: "Sim", metric: "count(distinct client_id, mecanismo_id) em client_mecanismos após dedupe", coverage: fixedCoverage(mechanismsSummary.availableMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.availableMechanisms ? 100 : 0), base: "BASE QV" },
        { indicator: "Clientes com mecanismos", viability: "Sim", metric: "count(distinct client_id) em client_mecanismos após dedupe; filtros de status do cliente", coverage: fixedCoverage(mechanismsSummary.clientsWithMechanisms, mechanismsSummary.portfolioClients, mechanismsSummary.mechanismCoveragePercent), base: "BASE QV" },
        { indicator: "Vínculos cliente + mecanismo", viability: "Sim", metric: "count(distinct client_id, mecanismo_id) em client_mecanismos", coverage: fixedCoverage(mechanismsSummary.availableMechanisms, mechanismsSummary.availableMechanisms, 100), base: "BASE QV" },
        { indicator: "Tipos utilizados / catálogo", viability: "Sim", metric: "tipos com ≥1 vínculo ÷ count(*) em public.mecanismos", coverage: fixedCoverage(mechanismsSummary.typesUsed, mechanismsSummary.catalogMechanisms, mechanismsSummary.catalogCoveragePercent), base: "BASE QV" },
        { indicator: "Status normalizado", viability: "Sim", metric: "apto→Apto; iniciado→Em andamento; concluido→Implementado", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Quantidade implementada", viability: "Sim", metric: "status Implementado após dedupe", coverage: fixedCoverage(mechanismsSummary.implementedMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.implementationPercent), base: "BASE QV" },
        { indicator: "Percentual implementado", viability: "Sim", metric: "implementados ÷ vínculos (nunca ÷ tipos)", coverage: fixedCoverage(mechanismsSummary.implementedMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.implementationPercent), base: "BASE QV" },
        { indicator: "Primeiro mecanismo implementado (Sim/Não)", viability: "Sim", metric: "Cliente com ao menos um implemented_at válido", coverage: fixedCoverage(mechanismsSummary.clientsWithImplementedMechanisms, mechanismsSummary.clientsWithMechanisms, mechanismsSummary.clientsWithImplementedPercent), base: "BASE QV" },
        { indicator: "Dias até primeira implementação", viability: "Sim", metric: "min(implemented_at) por cliente − data_inicio_ciclo/created_at; negativos excluídos", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Última implementação realizada", viability: "Sim", metric: "max(implemented_at) por cliente", coverage: fixedCoverage(mechanismsSummary.implementedMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.implementationPercent), base: "BASE QV" },
        { indicator: "Dias desde a última implementação", viability: "Sim", metric: "Data atual - max(implemented_at) por cliente", coverage: fixedCoverage(mechanismsSummary.implementedMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.implementationPercent), base: "BASE QV" },
        { indicator: "Média de implementações por mês", viability: "Sim", metric: "Implementações concluídas / meses desde contratação ou primeira implementação", coverage: fixedCoverage(mechanismsSummary.implementedMechanisms, mechanismsSummary.availableMechanisms, mechanismsSummary.implementationPercent), base: "BASE QV" },
        { indicator: "Mecanismos implementados por categoria", viability: "Parcial", metric: "Agregação por categoria/tipo do catálogo de mecanismos quando preenchido", coverage: fixedCoverage(mechanismsSummary.typesUsed, mechanismsSummary.catalogMechanisms, mechanismsSummary.catalogCoveragePercent), base: "BASE QV" },
        { indicator: "Implementação recente (30 dias)", viability: "Sim", metric: "clientes únicos com implemented_at nos últimos 30 dias", coverage: fixedCoverage(mechanismsSummary.clientsWithRecentImplementation, mechanismsSummary.clientsWithMechanisms, mechanismsSummary.recentImplementationPercent), base: "BASE QV" },
      ],
    },
    {
      id: "pharus",
      title: "App Pharus · Mecanismos sugeridos",
      subtitle: "Fonte: App Pharus — não misturar com implementação BASE QV",
      rows: [
        { indicator: "Usuários com mecanismos sugeridos", viability: "Parcial", metric: "count(distinct user_id) em user_mechanisms — endpoint /api/pharus-mechanisms disponível para outros dashboards", coverage: fixedCoverage(pharusSummary.usersWithSuggestions, pharusSummary.identifiedUsers, pharusPct(pharusSummary.usersWithSuggestions, pharusSummary.identifiedUsers)), base: "App Pharus" },
        { indicator: "Total de sugestões", viability: "Parcial", metric: "count(*) em user_mechanisms", coverage: fixedCoverage(pharusSummary.totalSuggestions, pharusSummary.suggestionRowsRaw, pharusSummary.suggestionRowsRaw ? 100 : 0), base: "App Pharus" },
        { indicator: "Tipos distintos sugeridos", viability: "Parcial", metric: "distinct mechanism_id (+ catálogo mechanisms.data)", coverage: fixedCoverage(pharusSummary.distinctSuggestedTypes, pharusSummary.catalogMechanisms, pharusPct(pharusSummary.distinctSuggestedTypes, pharusSummary.catalogMechanisms)), base: "App Pharus" },
        { indicator: "Mecanismo / mercado / categoria mais sugeridos", viability: "Parcial", metric: "Agregações sobre user_mechanisms ? mechanisms.data", coverage: fixedCoverage(pharusSummary.topSuggestedMechanism ? 1 : 0, pharusSummary.distinctSuggestedTypes, pharusSummary.topSuggestedMechanism ? 100 : 0), base: "App Pharus" },
        { indicator: "Sugestões recentes (30 dias)", viability: "Parcial", metric: "created_at da sugestão — não é implementação", coverage: fixedCoverage(pharusSummary.recentSuggestions30d, pharusSummary.totalSuggestions, pharusPct(pharusSummary.recentSuggestions30d, pharusSummary.totalSuggestions)), base: "App Pharus" },
        { indicator: "Mecanismos implementados", viability: "Sem dados", metric: "Sem status de conclusão / implemented_at no App Pharus auditado", coverage: fixedCoverage(0, 0, 0), base: "App Pharus" },
        { indicator: "Mecanismos implementados antes do cancelamento", viability: "Sem dados", metric: "Fonte localizada parcialmente no App Pharus, mas ainda sem evidência de implementação e data de conclusão", coverage: fixedCoverage(0, 0, 0), base: "App Pharus" },
      ],
    },
    {
      id: "financial",
      title: "Atualização Financeira",
      subtitle: "Indicadores novos da tela financeira",
      rows: [
        { indicator: "Dados financeiros cadastrados", viability: "Sim", metric: "client_financial_data por client_id", coverage: fixedCoverage(financialSummary.clientsWithFinancialData, financialSummary.totalClients, financialSummary.financialDataCoveragePercent), base: "BASE QV" },
        { indicator: "Dados atualizados nos últimos 30 dias", viability: "Sim", metric: "updated_at/created_at dentro dos últimos 30 dias", coverage: fixedCoverage(financialSummary.updatedLast30Days, financialSummary.clientsWithFinancialData, financialSummary.updatedLast30DaysPercentOfFinancial), base: "BASE QV" },
        { indicator: "Dias desde a última atualização financeira", viability: "Sim", metric: "Data atual - data financeira normalizada", coverage: fixedCoverage(financialSummary.clientsWithFinancialData, financialSummary.totalClients, financialSummary.financialDataCoveragePercent), base: "BASE QV" },
        { indicator: "Quantidade de atualizações financeiras", viability: "Parcial", metric: "Base atual registra o estado financeiro mais recente; sem histórico completo de eventos", coverage: fixedCoverage(financialSummary.clientsWithFinancialData, financialSummary.totalClients, financialSummary.financialDataCoveragePercent), base: "BASE QV" },
        { indicator: "Patrimônio atualizado recentemente (Sim/Não)", viability: "Parcial", metric: "Proxy por recência dos dados financeiros", coverage: fixedCoverage(financialSummary.updatedLast30Days, financialSummary.totalClients, financialSummary.updatedLast30DaysPercentOfPortfolio), base: "BASE QV" },
      ],
    },
    {
      id: "engagement",
      title: "Engajamento",
      subtitle: "Indicadores de respostas, interações e pesquisas",
      rows: [
        { indicator: "Tempo médio de resposta às solicitações", viability: "Sem dado", metric: "Indicador pausado nesta versão; aguardando fonte confiável e regra de pareamento", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Quantidade de respostas", viability: "Sem dado", metric: "Indicador pausado nesta versão; não usar App Pharus/QV360/BASE QV para este cálculo por enquanto", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Quantidade de interações", viability: "Sem dado", metric: "Indicador pausado nesta versão; eventos de formulários, avaliações, reuniões e outputs não serão consolidados", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Quantidade de mensagens respondidas", viability: "Sem dado", metric: "Sem tabela confiável de mensagens cliente ↔ EP", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Quantidade de mensagens ignoradas", viability: "Sem dado", metric: "Exige sent_at/responded_at/sender_type/message_status", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Tempo médio entre interação do EP e resposta do cliente", viability: "Sem dado", metric: "Sem pareamento confiável entre ação do EP e resposta posterior do cliente", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Cliente respondeu pesquisas? (Sim/Não)", viability: "Sem dado", metric: "Indicador pausado nesta versão; resposta de pesquisa não será calculada", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
      ],
    },
    {
      id: "platform",
      title: "Uso da Plataforma",
      subtitle: "Indicadores calculados pelo App Pharus",
      rows: indicatorRowsFromPayload(sources.pharus, [
        { indicator: "Realizou login? (Sim/Não)", viability: "Sim", metric: "Cliente/usuário com pelo menos um evento de acesso/login em App Pharus metrics.events.event_name" },
        { indicator: "Número total de logins", viability: "Sim", metric: "Contagem de eventos de login/acesso por usuário em App Pharus metrics.events.event_name" },
        { indicator: "Média de logins por mês", viability: "Sim", metric: "Total de logins/acessos dividido pelos meses entre o primeiro acesso e a data atual" },
        { indicator: "Dias desde o último acesso", viability: "Sim", metric: "Mediana por usuário de hoje menos último dia distinto com login de sucesso; datas negativas e outliers removidos" },
        { indicator: "Tempo médio entre acessos", viability: "Sim", metric: "Mediana por usuário entre penúltimo e último dia distinto com login de sucesso; datas negativas e outliers removidos" },
        { indicator: "Tempo médio de sessão", viability: "Sem dados", metric: "Sem Dados" },
        { indicator: "Frequência semanal de acesso", viability: "Sim", metric: "Total de acessos dividido pelas semanas desde o primeiro acesso" },
        { indicator: "Frequência mensal de acesso", viability: "Sim", metric: "Total de acessos dividido pelos meses desde o primeiro acesso" },
      ], "App Pharus / metrics.events"),
    },
    {
      id: "support",
      title: "Acionamentos",
      subtitle: "Indicadores de acionamentos em research.acionamentos",
      rows: [
        { indicator: "Quantidade de chamados", viability: "Sim", metric: "count(*) em research.acionamentos, via Business Data; fallback n8n quando REST não expõe schema", coverage: fixedCoverage(supportSummary.totalTickets, supportTickets.length, supportTickets.length ? 100 : 0), base: "Business Data / research" },
        { indicator: "Quantidade de reclamações", viability: "Parcial", metric: "Contagem por tipo_solicitacao/título/descrição quando classificado como reclamação", coverage: fixedCoverage(supportTickets.filter((t) => supportFold(`${t.type || ""} ${t.title || ""} ${t.description || ""}`).includes("reclam")).length, supportTickets.length, supportTickets.length ? (supportTickets.filter((t) => supportFold(`${t.type || ""} ${t.title || ""} ${t.description || ""}`).includes("reclam")).length / supportTickets.length) * 100 : 0), base: "Business Data / research" },
        { indicator: "Quantidade de elogios", viability: "Parcial", metric: "Contagem por tipo_solicitacao/título/descrição quando classificado como elogio", coverage: fixedCoverage(supportTickets.filter((t) => supportFold(`${t.type || ""} ${t.title || ""} ${t.description || ""}`).includes("elog")).length, supportTickets.length, supportTickets.length ? (supportTickets.filter((t) => supportFold(`${t.type || ""} ${t.title || ""} ${t.description || ""}`).includes("elog")).length / supportTickets.length) * 100 : 0), base: "Business Data / research" },
        { indicator: "Tempo médio de resolução", viability: "Sem dado", metric: "Necessário resolved_at/closed_at confiável; a tela atual usa abertura/status, sem data final estruturada validada", coverage: fixedCoverage(0, supportTickets.length, 0), base: "Business Data / research" },
        { indicator: "Escalou algum problema? (Sim/Não)", viability: "Parcial", metric: "Proxy por prioridade Urgente/Alta ou status/descrição indicando escalonamento; requer regra de negócio final", coverage: fixedCoverage(supportTickets.filter((t) => ["Urgente", "Alta"].includes(t.priority)).length, supportTickets.length, supportTickets.length ? (supportTickets.filter((t) => ["Urgente", "Alta"].includes(t.priority)).length / supportTickets.length) * 100 : 0), base: "Business Data / research" },
        { indicator: "Cliente identificado", viability: "Sim", metric: "Acionamentos com vínculo de cliente/e-mail identificado", coverage: fixedCoverage(supportSummary.identifiedClients, supportSummary.totalTickets, supportSummary.identifiedPercent), base: "Business Data / research" },
        { indicator: "Prioridade, área, tipo, origem e período", viability: "Sim", metric: "Distribuições por priority, area/setor, tipo_solicitacao, origin e opened_at", coverage: fixedCoverage(supportSummary.totalTickets, supportTickets.length, supportTickets.length ? 100 : 0), base: "Business Data / research" },
      ],
    },
    {
      id: "cancellations",
      title: "Cancelamento",
      subtitle: "Indicadores da BASE QV (sem App Pharus nesta versão)",
      rows: [
        { indicator: "Total de cancelamentos", viability: "Sim", metric: "count(distinct client_id) com data consolidada válida", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Motivo do cancelamento", viability: "Sim", metric: "cancellations.motivo (+ fallback clients.motivo_churn)", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Categoria do motivo", viability: "Sim", metric: "Categoria analítica calculada a partir de cancellations.motivo (não usa motivo_categoria)", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Tempo até cancelamento", viability: "Sim", metric: "cancelamento - (data_inicio_ciclo | created_at); mediana", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Reuniões antes do cancelamento", viability: "Sim", metric: "Presença confirmada (compareceu) com data <= cancelamento", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Última atualização financeira", viability: "Sim", metric: "client_financial_data.updated_at|created_at <= cancelamento", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Dias desde a última reunião", viability: "Sim", metric: "Interação v1 = última reunião realizada antes do cancelamento", coverage: fixedCoverage(0, 0, 0), base: "BASE QV" },
        { indicator: "Mecanismos antes do cancelamento", viability: "Sem dados", metric: "Fonte localizada parcialmente no App Pharus, mas ainda sem evidência de implementação e data de conclusão", base: "App Pharus" },
        { indicator: "Último acesso antes do cancelamento", viability: "Sem dados", metric: "Pendente App Pharus — não exibido nesta versão", base: "App Pharus" },
      ],
    },
    {
      id: "satisfaction",
      title: "Pesquisa de Satisfação",
      subtitle: "NPS, CSAT e evolução temporal",
      rows: indicatorRowsFromPayload(sources.satisfaction, [
        { indicator: "NPS", viability: "Sim", metric: "Promotores% - Detratores% usando nps_responses.score" },
        { indicator: "Data do NPS", viability: "Sim", metric: "nps_responses.created_at" },
        { indicator: "Quantidade de respostas de NPS", viability: "Sim", metric: "count(distinct nps_responses.typeform_response_id/id)" },
        { indicator: "Último NPS", viability: "Sim", metric: "Última resposta por created_at desc" },
        { indicator: "CSAT", viability: "Sim", metric: "csat_responses.score filtrando tipo_de_forms = CSAT; notas > 5 viram 5; satisfeito = 5" },
        { indicator: "CES", viability: "Sem dado", metric: "Sem campo/tabela estruturada de CES" },
        { indicator: "Evolução do NPS ao longo do tempo", viability: "Sim", metric: "NPS trimestral; última resposta por cliente em cada trimestre, usando nps_responses.created_at" },
      ], "BASE QV"),
    },
    {
      id: "renewal",
      title: "Renovação",
      subtitle: "Indicadores parciais por ciclo do cliente",
      rows: [
        { indicator: "Renovou? (Sim/Não)", viability: "Parcial", metric: "Proxy: clients.ciclo > 1", coverage: fixedCoverage(renewalSummary.clientsWithCycle, renewalSummary.totalClients, renewalSummary.cycleCoveragePercent), base: "BASE QV" },
        { indicator: "Quantidade de renovações", viability: "Parcial", metric: "Proxy: max(clients.ciclo - 1, 0)", coverage: fixedCoverage(renewalSummary.clientsWithCycle, renewalSummary.totalClients, renewalSummary.cycleCoveragePercent), base: "BASE QV" },
        { indicator: "Tempo até renovação", viability: "Sem dado", metric: "Falta histórico do primeiro contrato/ciclo e evento real de renovação", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Renovou no prazo?", viability: "Sem dado", metric: "Falta data do fim do ciclo anterior e data real de renovação", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Valor da renovação", viability: "Sem dado", metric: "clients.valor_total_pago não representa valor de renovação; apenas 1 cliente com valor > 0 na auditoria", coverage: fixedCoverage(0, renewalSummary.totalClients, 0), base: "Sem dado" },
      ],
    },
    {
      id: "ep",
      title: "Performance",
      subtitle: "Indicadores por Engenheiro Patrimonial",
      rows: [
        { indicator: "EP responsável", viability: "Sim", metric: "clients.engenheiro_patrimonial normalizado por cliente", coverage: fixedCoverage(epSummary.clientsWithEngineer, epSummary.totalClients, epSummary.engineerCoveragePercent), base: "BASE QV" },
        { indicator: "Taxa média de cancelamento do EP", viability: "Sim", metric: "Clientes cancelados do EP ÷ total de clientes do EP", coverage: fixedCoverage(epSummary.clientsWithCancellationStatus, epSummary.totalClients, epSummary.churnCoveragePercent), base: "BASE QV" },
        { indicator: "NPS médio do EP", viability: "Sem dado", metric: "Sem vínculo confiável entre resposta de NPS e EP responsável nesta versão", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Média de reuniões do EP", viability: "Sim", metric: "Soma de reuniões dos clientes do EP ÷ clientes do EP", coverage: fixedCoverage(epSummary.clientsWithMeetingData, epSummary.totalClients, epSummary.meetingCoveragePercent), base: "BASE QV" },
        { indicator: "Média de mecanismos implementados pelo EP", viability: "Sim", metric: "Soma de mecanismos implementados dos clientes do EP ÷ clientes do EP", coverage: fixedCoverage(epSummary.clientsWithMechanismData, epSummary.totalClients, epSummary.mechanismCoveragePercent), base: "BASE QV" },
        { indicator: "Tempo médio de resposta do EP", viability: "Sem dado", metric: "Sem pareamento confiável entre solicitação, EP e resposta nesta versão", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
        { indicator: "Taxa de renovação do EP", viability: "Sem dado", metric: "Sem evento/campo confiável de renovação vinculado ao EP nesta versão", coverage: fixedCoverage(0, 0, 0), base: "Sem dado" },
      ],
    },
    {
      id: "temporal",
      title: "Indicadores Temporais",
      subtitle: "Evolução mensal por cliente/usuário",
      rows: indicatorRowsFromPayload(sources.temporal, [
        { indicator: "Logins", viability: "Sim", metric: "App Pharus metrics.events por user_id e mês" },
        { indicator: "Reuniões", viability: "Sim", metric: "BASE QV client_meetings/manual_meetings por client_id e mês" },
        { indicator: "Implementações", viability: "Sim", metric: "BASE QV client_mecanismos.implemented_at por client_id e mês" },
        { indicator: "Atualizações financeiras", viability: "Sim", metric: "BASE QV client_financial_data.updated_at/created_at por client_id e mês" },
        { indicator: "NPS", viability: "Parcial", metric: "BASE QV nps_responses.score por client_id e mês" },
        { indicator: "Interações", viability: "Sem dados", metric: "Sem tabela confiável cliente ↔ EP" },
        { indicator: "Patrimônio", viability: "Parcial", metric: "Snapshot financeiro mensal aproximado quando existe histórico" },
        { indicator: "Dias sem atividade", viability: "Sim", metric: "Fim do mês - última atividade conhecida" },
      ], "App Pharus + BASE QV"),
    },
  ];
}
