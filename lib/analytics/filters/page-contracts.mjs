/**
 * Filter Contract por página.
 * periodSensitive=false: o período global NÃO recorta aquele componente.
 */
import { PAGES, isPageImplemented } from "../../../js/pages.js";

const STOCK = { period: false, status: true, engineer: true, segment: true, search: true };
const STOCK_NO_SEGMENT = { period: false, status: true, engineer: true, segment: false, search: true };
const EVENT_ACQ = { period: true, status: false, engineer: true, segment: true, search: true };
const MEETING_EVENT = { period: true, status: true, engineer: true, segment: false, search: true };
const CALENDLY_PERIOD = { period: true, status: false, engineer: false, segment: false, search: false };
const JOURNEY = { period: true, status: true, engineer: true, segment: false, search: true, program: true };
const PLAN = { period: true, status: false, engineer: true, segment: false, search: true, program: true };
const MECH_STOCK = { period: false, status: true, engineer: true, segment: true, search: true, program: true };
const MECH_EVENT = { period: true, status: true, engineer: true, segment: true, search: false, program: true };
const FIN_STOCK = { period: false, status: true, engineer: true, segment: true, search: true, program: true, financialTraits: true };
const FIN_EVENT = { period: true, status: true, engineer: true, segment: true, search: true, program: true, financialTraits: true };
const CANCEL_STOCK = { period: false, status: true, engineer: true, segment: true, search: true, program: true };
const CANCEL_EFFECTIVE = { period: true, status: true, engineer: true, segment: true, search: true, program: true };
const CANCEL_INTENTION = { period: true, status: true, engineer: true, segment: true, search: true, program: true };
const SAT_STOCK = { period: false, status: false, engineer: true, segment: false, search: true, program: true };
const RENEWAL_STOCK = { period: false, status: false, engineer: true, segment: true, search: true, program: true, renewed: true };

export const PAGE_FILTER_CONTRACTS = {
  general: {
    pageId: "general",
    slug: "dados-gerais",
    period: {
      required: true,
      dateField: "contractDate",
      dateFieldLabel: "data de contratação",
      semantics:
        "O período global aplica-se à evolução da aquisição (evento). Cards de estoque, distribuições cadastrais e a tabela de clientes permanecem current-state do recorte Status/EP/Segmento/Contratação/Cancelamento/Permanência/Busca. Contratação/Cancelamento já existentes continuam recortando a carteira — não confundir com o período global.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "status", "segment", "engineer", "program", "contract", "cancel", "stay"],
    unimplementedVisualFilters: [],
    notes: [
      "Filtros Contratação e Cancelamento já recortavam a carteira inteira; o período global não replica isso nos cards de estoque.",
    ],
    components: [
      { id: "active_clients", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "total_clients", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "typical_stay", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "financial_profile", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "frozen_clients", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "cancelled_clients", type: "kpi", periodSensitive: false, filters: STOCK },
      { id: "status_chart", type: "chart", periodSensitive: false, filters: STOCK },
      { id: "income_chart", type: "chart", periodSensitive: false, filters: STOCK },
      { id: "segment_chart", type: "chart", periodSensitive: false, filters: STOCK },
      { id: "engineer_chart", type: "chart", periodSensitive: false, filters: STOCK },
      { id: "stay_chart", type: "chart", periodSensitive: false, filters: STOCK },
      { id: "acquisition_chart", type: "chart", periodSensitive: true, filters: EVENT_ACQ },
      { id: "clients_table", type: "table", periodSensitive: false, filters: STOCK },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "contractDate", header: "Contratação", type: "date" },
      { key: "cancellationDate", header: "Cancelamento", type: "date" },
      { key: "stayDays", header: "Permanência (dias)", type: "number" },
      { key: "analyticalStatus", header: "Status" },
      { key: "segmentLabel", header: "Segmento" },
      { key: "engineer", header: "EP" },
      { key: "monthlyIncome", header: "Renda", type: "number" },
      { key: "lastContribution", header: "Aporte", type: "number" },
      { key: "liquidityReserve", header: "Liquidez", type: "number" },
      { key: "hasProperty", header: "Imóvel", type: "boolean" },
      { key: "hasCar", header: "Carro", type: "boolean" },
      { key: "hasConsortium", header: "Consórcio", type: "boolean" },
    ],
  },
  journey: {
    pageId: "journey",
    slug: "jornada",
    period: {
      required: true,
      dateField: "contractDate",
      dateFieldLabel: "data de entrada/contratação",
      semantics:
        "Coorte de onboarding: o período recorta clientes pela data de contratação. Medianas e conclusão são recalculadas nessa coorte. A metodologia de conclusão e dos marcos não muda.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "status", "engineer", "completion", "program"],
    unimplementedVisualFilters: [],
    notes: ["Segmento não existe nesta página."],
    components: [
      { id: "completed_onboarding", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "open_onboarding", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "completion_percent", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "completion_chart", type: "chart", periodSensitive: true, filters: JOURNEY },
      { id: "total_onboarding_chart", type: "chart", periodSensitive: true, filters: JOURNEY },
      { id: "median_total", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "median_first_meeting", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "median_plan", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "median_first_mechanism", type: "kpi", periodSensitive: true, filters: JOURNEY },
      { id: "first_meeting_chart", type: "chart", periodSensitive: true, filters: JOURNEY },
      { id: "plan_delivery_chart", type: "chart", periodSensitive: true, filters: JOURNEY },
      { id: "clients_table", type: "table", periodSensitive: true, filters: JOURNEY },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "analyticalStatus", header: "Status" },
      { key: "completedOnboarding", header: "Concluiu onboarding", type: "boolean" },
      { key: "contractDate", header: "Contratação", type: "date" },
      { key: "totalOnboardingDays", header: "Onboarding (dias)", type: "number" },
      { key: "daysToFirstMeeting", header: "Dias até 1ª reunião", type: "number" },
      { key: "daysToPlanDelivery", header: "Dias até plano", type: "number" },
    ],
  },
  meetings: {
    pageId: "meetings",
    slug: "reunioes",
    period: {
      required: true,
      dateField: "startTime",
      dateFieldLabel: "start_time da reunião",
      semantics:
        "Período recorta reuniões analíticas por start_time e reenriquece métricas do cliente. Reuniões por tipo (Calendly) respeitam só o período; status/EP/busca não se aplicam a essa fonte.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "period", "status", "engineer", "program", "attendance", "freq", "first", "absence", "reschedule"],
    unimplementedVisualFilters: [],
    notes: ["Calendly não recebe Status, EP nem busca."],
    components: [
      { id: "clients_with_meeting", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "total_meetings", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "attendance_rate", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "no_shows", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "reschedules", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "avg_per_month", type: "kpi", periodSensitive: true, filters: MEETING_EVENT },
      { id: "meetings_month_chart", type: "chart", periodSensitive: true, filters: MEETING_EVENT },
      { id: "meetings_ep_chart", type: "chart", periodSensitive: true, filters: MEETING_EVENT },
      { id: "status_chart", type: "chart", periodSensitive: true, filters: MEETING_EVENT },
      { id: "frequency_chart", type: "chart", periodSensitive: true, filters: MEETING_EVENT },
      { id: "types_chart", type: "chart", periodSensitive: true, filters: CALENDLY_PERIOD },
      { id: "clients_table", type: "table", periodSensitive: true, filters: MEETING_EVENT },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "analyticalStatus", header: "Status" },
      { key: "totalMeetings", header: "Reuniões", type: "number" },
      { key: "completedMeetings", header: "Compareceu", type: "number" },
      { key: "absences", header: "No-shows", type: "number" },
      { key: "reschedules", header: "Remarcações", type: "number" },
      { key: "firstMeetingCompleted", header: "Primeira reunião", type: "boolean" },
      { key: "frequencyBand", header: "Frequência" },
    ],
  },
  patrimonial_plan: {
    pageId: "patrimonial_plan",
    slug: "plano-patrimonial",
    period: {
      required: true,
      dateField: "approvedAt",
      dateFieldLabel: "data da última reunião Central de Inteligência",
      semantics:
        "Métrica histórica da carteira completa (não active-first). O período recorta pela data da reunião Central usada como proxy de aprovação. A fórmula continua sendo a média dos dias contratação → Central.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "engineer", "program"],
    unimplementedVisualFilters: [],
    notes: ["Status e segmento não entram para não transformar a métrica em active-first."],
    components: [
      { id: "plan_days_to_approval", type: "kpi", periodSensitive: true, filters: PLAN },
      { id: "clients_table", type: "table", periodSensitive: true, filters: PLAN },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "contractDate", header: "Contratação", type: "date" },
      { key: "approvedAt", header: "Reunião Central", type: "date" },
      { key: "daysToApproval", header: "Dias até aprovação", type: "number" },
    ],
  },
  mechanisms: {
    pageId: "mechanisms",
    slug: "mecanismos",
    period: {
      required: true,
      dateField: "implementedAt",
      dateFieldLabel: "implemented_at da implementação",
      semantics:
        "Cards de estoque (vínculos atuais, tipos, status, cobertura) ignoram o período. O gráfico de implementações por mês e a leitura de eventos usam implemented_at. Vínculo atual não é excluído só por estar fora do período.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "status", "engineer", "segment", "program", "mechStatus", "mechanism", "category", "countBand", "hasImpl"],
    unimplementedVisualFilters: [],
    notes: ["Mecanismo multiselect (OR). Cards de estoque ignoram período; gráfico mensal usa implemented_at."],
    components: [
      { id: "implemented_mechanisms", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "in_progress", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "implementation_percent", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "top_mechanism", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "clients_with_mechanisms", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "types_used", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "recent_clients", type: "kpi", periodSensitive: false, filters: MECH_STOCK },
      { id: "status_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "count_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "catalog_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "types_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "months_chart", type: "chart", periodSensitive: true, filters: MECH_EVENT },
      { id: "segment_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "ep_chart", type: "chart", periodSensitive: false, filters: MECH_STOCK },
      { id: "clients_table", type: "table", periodSensitive: false, filters: MECH_STOCK },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "segment", header: "Segmento" },
      { key: "analyticalStatus", header: "Status" },
      { key: "available", header: "Vínculos", type: "number" },
      { key: "implemented", header: "Implementados", type: "number" },
      { key: "implementationPercent", header: "% implementado", type: "number" },
    ],
  },
  financial_updates: {
    pageId: "financial_updates",
    slug: "financeiro",
    period: {
      required: true,
      dateField: "financialUpdateDate",
      dateFieldLabel: "updated_at (somente quando updated_at > created_at)",
      semantics:
        "Eventos de atualização usam financialUpdateDate (updated_at > created_at). Cards de estoque/cobertura permanecem current-state e ignoram o período. Multiselect financeiro: OR entre opções; AND com demais filtros.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "period", "status", "engineer", "segment", "program", "financialTraits"],
    unimplementedVisualFilters: [],
    notes: ["Default: clientes ativos. Período recorta eventos (série mensal); KPIs de estoque não usam período."],
    components: [
      { id: "clients_with_financial_data", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "post_creation_updates", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "updated_last_30_days", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "median_days_since_update", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "outdated_over_90_days", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "financial_to_activation", type: "kpi", periodSensitive: false, filters: FIN_STOCK },
      { id: "recency_chart", type: "chart", periodSensitive: false, filters: FIN_STOCK },
      { id: "updates_by_month_chart", type: "chart", periodSensitive: true, filters: FIN_EVENT },
      { id: "field_coverage_chart", type: "chart", periodSensitive: false, filters: FIN_STOCK },
      { id: "updates_by_engineer_chart", type: "chart", periodSensitive: false, filters: FIN_STOCK },
      { id: "clients_table", type: "table", periodSensitive: false, filters: FIN_STOCK },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "analyticalStatus", header: "Status" },
      { key: "hasFinancialData", header: "Possui dados", type: "boolean" },
      { key: "financialUpdateDate", header: "Última atualização", type: "date" },
      { key: "daysSinceFinancialUpdate", header: "Dias desde atualização", type: "number" },
      { key: "updatedLast30Days", header: "Atualizado 30d", type: "boolean" },
      { key: "outdatedOver90Days", header: "> 90 dias", type: "boolean" },
      { key: "filledFinancialFields", header: "Campos preenchidos", type: "number" },
    ],
  },
  satisfaction: {
    pageId: "satisfaction",
    slug: "satisfacao",
    period: {
      required: false,
      dateField: null,
      dateFieldLabel: null,
      semantics: "Sem filtro global de período; NPS/CSAT usam created_at das respostas.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "engineer", "program"],
    unimplementedVisualFilters: [],
    notes: ["Universo de respondentes. CES não entra no Dash Kids."],
    components: [
      { id: "nps", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "latest_nps_date", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "nps_responses", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "latest_nps", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "csat_average", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "csat_satisfied", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "clients_with_feedback", type: "kpi", periodSensitive: false, filters: SAT_STOCK },
      { id: "nps_classification_chart", type: "chart", periodSensitive: false, filters: SAT_STOCK },
      { id: "csat_chart", type: "chart", periodSensitive: false, filters: SAT_STOCK },
      { id: "clients_table", type: "table", periodSensitive: false, filters: SAT_STOCK },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "latestNps", header: "Último NPS", type: "number" },
      { key: "latestNpsAt", header: "Data NPS", type: "date" },
      { key: "npsResponses", header: "Respostas NPS", type: "number" },
      { key: "averageCsat", header: "CSAT médio", type: "number" },
      { key: "csatResponses", header: "Respostas CSAT", type: "number" },
    ],
  },
  cancellations: {
    pageId: "cancellations",
    slug: "cancelamento",
    period: {
      required: true,
      dateField: "cancellationDate",
      dateFieldLabel: "data analítica consolidada de efetivação",
      semantics:
        "Efetivados: churn_efetivado_at > distrato_assinado_at > data_churn (sem data confirmada fica fora de séries temporais). Intenções: intencao_registrada_at. Pedidos: data_pedido. KPIs de estoque (em processo) ignoram período.",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "period", "status", "engineer", "segment", "program"],
    unimplementedVisualFilters: [],
    notes: ["População de processo/cancelamento. Período por componente conforme data canônica."],
    components: [
      { id: "effective_cancellations", type: "kpi", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "intentions_or_orders", type: "kpi", periodSensitive: true, filters: CANCEL_INTENTION },
      { id: "clients_in_process", type: "kpi", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "critical_cases", type: "kpi", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "without_responsible", type: "kpi", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "archived_records", type: "kpi", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "non_renewals", type: "kpi", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "before_cycle_end", type: "kpi", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "process_status_chart", type: "chart", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "branch_funnel", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "exclusive_stage_chart", type: "chart", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "client_stage_chart", type: "chart", periodSensitive: false, filters: CANCEL_STOCK },
      { id: "reason_category_chart", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "reason_semester_chart", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "intention_vs_effective_month_chart", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "effective_by_engineer_chart", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "effective_by_segment_chart", type: "chart", periodSensitive: true, filters: CANCEL_EFFECTIVE },
      { id: "clients_table", type: "table", periodSensitive: true, filters: CANCEL_EFFECTIVE },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "segment", header: "Segmento" },
      { key: "analyticalStatus", header: "Status" },
      { key: "exclusiveStage", header: "Etapa exclusiva" },
      { key: "processStatusName", header: "Status do processo" },
      { key: "cancellationDate", header: "Cancelamento", type: "date" },
      { key: "reasonCategory", header: "Categoria" },
      { key: "reason", header: "Motivo" },
      { key: "hasEfetivado", header: "Efetivado", type: "boolean" },
      { key: "inProcessCurrently", header: "Em processo", type: "boolean" },
    ],
  },
  reports: {
    pageId: "reports",
    slug: "relatorios",
    period: {
      required: false,
      dateField: null,
      dateFieldLabel: null,
      semantics:
        "Página de publicação de relatórios internos; busca e filtro de tipo são locais, sem filtro global de período.",
    },
    search: {
      tables: ["reports"],
      fields: { name: "title", code: null, id: "id" },
      codeAvailable: false,
      codeField: null,
      codeSource: null,
    },
    export: { tables: [], formats: ["csv", "xlsx"] },
    uiFilters: [],
    unimplementedVisualFilters: [],
    notes: ["Não é dashboard analítico; upload via Storage privado + metadados analytics.reports."],
    components: [
      { id: "reports_list", type: "table", periodSensitive: false, filters: { search: true } },
    ],
    exportColumns: [],
  },
  renewal: {
    pageId: "renewal",
    slug: "renovacao",
    period: {
      required: false,
      dateField: null,
      dateFieldLabel: null,
      semantics: "Sem filtro global de período; renovação inferida por clients.ciclo (sem data de evento).",
    },
    search: {
      tables: ["clients"],
      fields: { name: "clientName", code: "clientCode", id: "clientId" },
      codeAvailable: true,
      codeField: "clientCode",
      codeSource: "clients.codigo",
    },
    export: { tables: ["clients"], formats: ["csv", "xlsx"] },
    uiFilters: ["search", "engineer", "segment", "program", "renewed"],
    unimplementedVisualFilters: [],
    notes: ["Renovação inferida por clients.ciclo. Sem filtro global de período."],
    components: [
      { id: "renewed_clients", type: "kpi", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "total_renewals", type: "kpi", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "max_current_cycle", type: "kpi", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "renewed_chart", type: "chart", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "renewal_count_chart", type: "chart", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "renewed_by_engineer_chart", type: "chart", periodSensitive: false, filters: RENEWAL_STOCK },
      { id: "clients_table", type: "table", periodSensitive: false, filters: RENEWAL_STOCK },
    ],
    exportColumns: [
      { key: "clientName", header: "Cliente" },
      { key: "clientCode", header: "Código" },
      { key: "clientId", header: "ID" },
      { key: "engineer", header: "EP" },
      { key: "segment", header: "Segmento" },
      { key: "analyticalStatus", header: "Status" },
      { key: "renewed", header: "Renovou", type: "boolean" },
      { key: "currentCycle", header: "Ciclo atual", type: "number" },
      { key: "renewalCount", header: "Renovações", type: "number" },
      { key: "contractDate", header: "Contratação", type: "date" },
      { key: "cycleEndDate", header: "Fim do ciclo", type: "date" },
    ],
  },
};

export function pageUiFilters(pageId) {
  return getPageFilterContract(pageId)?.uiFilters || [];
}

export function pageShowsPeriodUi(pageId) {
  return pageUiFilters(pageId).includes("period");
}

/**
 * Filtra o catálogo de campos da página conforme uiFilters do contrato.
 * Campos period/search usam kind; selects usam key.
 */
export function resolveVisibleFilterFields(pageId, catalog = []) {
  const allowed = new Set(pageUiFilters(pageId));
  return (catalog || []).filter((field) => {
    const key = field.uiKey || (field.kind === "period" ? "period" : field.key);
    return key && allowed.has(key);
  });
}

export function getPageFilterContract(pageId) {
  return PAGE_FILTER_CONTRACTS[pageId] || null;
}

export function implementedPageIds() {
  return PAGES.filter((page) => page.implemented).map((page) => page.id);
}

export function pagesMissingFilterContract() {
  return implementedPageIds().filter((id) => !PAGE_FILTER_CONTRACTS[id]);
}

export function periodSensitiveIds(pageId) {
  return (getPageFilterContract(pageId)?.components || [])
    .filter((item) => item.periodSensitive)
    .map((item) => item.id);
}

export function periodInsensitiveIds(pageId) {
  return (getPageFilterContract(pageId)?.components || [])
    .filter((item) => item.periodSensitive === false)
    .map((item) => item.id);
}

export { isPageImplemented };
