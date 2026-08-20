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
const JOURNEY = { period: true, status: true, engineer: true, segment: false, search: true };
const PLAN = { period: true, status: false, engineer: true, segment: false, search: true };
const MECH_STOCK = { period: false, status: true, engineer: true, segment: true, search: true };
const MECH_EVENT = { period: true, status: true, engineer: true, segment: true, search: false };

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
    uiFilters: ["search", "status", "engineer", "completion"],
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
    uiFilters: ["search", "period", "status", "engineer", "attendance", "freq", "first", "absence", "reschedule"],
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
    uiFilters: ["search", "engineer"],
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
    uiFilters: ["search", "status", "engineer", "segment", "mechStatus", "mechanism", "category", "countBand", "hasImpl", "recent", "pctRange"],
    unimplementedVisualFilters: [],
    notes: ["Filtro Recente (30 dias) permanece relativo a hoje, independente do período global."],
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
