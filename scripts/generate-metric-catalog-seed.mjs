/**
 * Gera o seed do catálogo analítico V2 a partir do CSV oficial e do catálogo da V1.
 * Somente leitura da V1. Não consulta BASE QV.
 *
 * Uso: node scripts/generate-metric-catalog-seed.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CSV_CANDIDATES = [
  join(ROOT, "sql", "analytics", "source", "confiabilidade-indicadores-pagina1.csv"),
  resolve(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "confiabilidade-indicadores - Página1 (1).csv"),
];
const V1_CATALOG = resolve(
  ROOT,
  "..",
  "analytics_jornada_cliente",
  "analytics_jornada_cliente",
  "netlify",
  "functions",
  "_shared",
  "portal-metric-catalog.mjs",
);

const VALIDATED_PAGES = new Set(["general", "journey", "meetings", "patrimonial_plan", "mechanisms"]);

const PAGE_MAP = {
  "Dados Gerais": { id: "general", label: "Dados Gerais" },
  "Jornada e onboarding": { id: "journey", label: "Jornada e Onboarding" },
  Reuniões: { id: "meetings", label: "Reuniões" },
  "Plano Patrimonial": { id: "patrimonial_plan", label: "Plano Patrimonial" },
  "Implementação de Mecanismos": { id: "mechanisms", label: "Implementação de Mecanismos" },
};

const DOMAIN_PAGE = {
  general: { id: "general", label: "Dados Gerais" },
  meetings: { id: "meetings", label: "Reuniões" },
  journey: { id: "journey", label: "Jornada e Onboarding" },
  mechanisms: { id: "mechanisms", label: "Implementação de Mecanismos" },
  pharus_mechanisms: { id: "mechanisms", label: "Implementação de Mecanismos" },
  support: { id: "support", label: "Acionamentos" },
  ep_performance: { id: "ep_performance", label: "Performance do Engenheiro Patrimonial" },
  statistical_crosses: { id: "statistical_crosses", label: "Análises Estatísticas" },
  cancellations: { id: "cancellations", label: "Cancelamento" },
  patrimonial_plan: { id: "patrimonial_plan", label: "Plano Patrimonial" },
  financial_updates: { id: "financial_updates", label: "Atualização Financeira" },
  platform_usage: { id: "platform_usage", label: "Uso da Plataforma" },
  satisfaction: { id: "satisfaction", label: "Pesquisa de Satisfação" },
  renewal: { id: "renewal", label: "Renovação" },
  temporal_indicators: { id: "temporal_indicators", label: "Indicadores Temporais" },
  temporal: { id: "temporal_indicators", label: "Indicadores Temporais" },
  quality: { id: "quality", label: "Qualidade dos Dados" },
  engagement: { id: "temporal_indicators", label: "Indicadores Temporais" },
};

const CSV_IDS = {
  "Dados Gerais|Cancelados confirmados|Cartão": "cancelled_clients",
  "Dados Gerais|Cancelados sem data confirmada|Cartão": "cancelled_without_confirmed_date",
  "Dados Gerais|Clientes ativos|Cartão": "active_clients",
  "Dados Gerais|Clientes com diagnóstico financeiro|Cartão": "clients_with_financial_data",
  "Dados Gerais|Clientes congelados|Cartão": "frozen_clients",
  "Dados Gerais|Clientes não ativos|Cartão": "non_active_clients",
  "Dados Gerais|Permanência média|Cartão": "median_stay_days",
  "Dados Gerais|Renda mensal média|Cartão": "median_monthly_income",
  "Dados Gerais|Reserva de liquidez média|Cartão": "median_liquidity_reserve",
  "Dados Gerais|Total de clientes|Cartão": "total_clients",
  "Dados Gerais|Último aporte médio|Cartão": "median_last_contribution",
  "Dados Gerais|Clientes por segmento|Gráfico": "clients_by_segment",
  "Dados Gerais|Clientes por status|Gráfico": "clients_by_status",
  "Dados Gerais|Distribuição da renda mensal|Gráfico": "monthly_income_distribution",
  "Dados Gerais|Distribuição da reserva de liquidez|Gráfico": "liquidity_reserve_distribution",
  "Dados Gerais|Engenheiro Patrimonial|Gráfico": "clients_by_engineer",
  "Dados Gerais|Evolução mensal da aquisição de clientes|Gráfico": "client_acquisition_monthly",
  "Dados Gerais|Perfil Financeiro|Gráfico": "financial_profile_distribution",
  "Dados Gerais|Tempo de permanência|Gráfico": "stay_duration_distribution",
  "Jornada e onboarding|Mediana onboarding total|Cartão": "average_onboarding_days",
  "Jornada e onboarding|Mediana até 1ª reunião|Cartão": "average_days_to_first_meeting",
  "Jornada e onboarding|Mediana até entrega do plano|Cartão": "average_days_to_plan_delivery",
  "Jornada e onboarding|Mediana até 1º mecanismo|Cartão": "average_days_to_first_mechanism",
  "Jornada e onboarding|Concluíram onboarding|Cartão": "completed_onboarding_clients",
  "Jornada e onboarding|Dias até a primeira reunião|Gráfico": "days_to_first_meeting_chart",
  "Jornada e onboarding|Dias até entrega do plano patrimonial|Gráfico": "days_to_plan_delivery_chart",
  "Jornada e onboarding|Dias até primeiro mecanismo implementado|Gráfico": "days_to_first_mechanism_chart",
  "Jornada e onboarding|Tempo total de onboarding|Gráfico": "total_onboarding_time_chart",
  "Jornada e onboarding|Concluiu onboarding|Gráfico": "onboarding_completion_chart",
  "Reuniões|Total de reuniões|Cartão": "total_meetings",
  "Reuniões|Média de reuniões/mês|Cartão": "average_meetings_per_month",
  "Reuniões|Dias desde a última reunião|Cartão": "days_since_latest_meeting",
  "Reuniões|Intervalo médio entre reuniões|Cartão": "average_interval_between_meetings",
  "Reuniões|Total de no-shows|Cartão": "no_show_meetings",
  "Reuniões|Remarcações|Cartão": "total_meeting_reschedules",
  "Reuniões|Taxa de comparecimento|Cartão": "attendance_rate",
  "Reuniões|Clientes com reunião|Cartão": "clients_with_meeting",
  "Reuniões|Reuniões por mês|Gráfico": "meetings_by_month_chart",
  "Reuniões|Status das reuniões|Gráfico": "meeting_status_chart",
  "Reuniões|Frequência por cliente|Gráfico": "meeting_frequency_chart",
  "Reuniões|Dias desde a última reunião|Gráfico": "days_since_last_meeting_chart",
  "Reuniões|Intervalo médio entre reuniões|Gráfico": "meeting_interval_chart",
  "Reuniões|Frequência de no-show por cliente|Gráfico": "noshow_frequency_chart",
  "Reuniões|Reuniões por tipo|Gráfico": "top_meeting_types",
  "Reuniões|Reuniões por Engenheiro Patrimonial|Gráfico": "meetings_by_engineer_chart",
  "Plano Patrimonial|Plano aprovado|Cartão": "plan_approved_clients",
  "Plano Patrimonial|Dias até aprovação|Cartão": "plan_days_to_approval",
  "Plano Patrimonial|Status do plano|Gráfico": "plan_status_chart",
  "Implementação de Mecanismos|Clientes com mecanismos — BASE QV|Cartão": "clients_with_mechanisms",
  "Implementação de Mecanismos|Tipos de mecanismos|Cartão": "types_used",
  "Implementação de Mecanismos|Tipos sem utilização|Cartão": "types_unused",
  "Implementação de Mecanismos|Mecanismo mais utilizado|Cartão": "most_used_mechanism",
  "Implementação de Mecanismos|Mecanismos implementados|Cartão": "implemented_mechanisms",
  "Implementação de Mecanismos|Em andamento|Cartão": "in_progress_mechanisms",
  "Implementação de Mecanismos|Percentual implementado|Cartão": "implementation_rate",
  "Implementação de Mecanismos|Tempo médio até a primeira implementação|Cartão": "average_days_to_first_implementation",
  "Implementação de Mecanismos|Clientes com implementação recente|Cartão": "clients_with_recent_implementation",
  "Implementação de Mecanismos|Status dos vínculos|Gráfico": "mechanism_status_chart",
  "Implementação de Mecanismos|Quantidade de mecanismos por cliente|Gráfico": "mechanisms_per_client_chart",
  "Implementação de Mecanismos|Cobertura do catálogo|Gráfico": "catalog_coverage_chart",
  "Implementação de Mecanismos|Utilização por tipo de mecanismo|Gráfico": "mechanism_type_usage_chart",
  "Implementação de Mecanismos|Implementações por mês|Gráfico": "implementations_by_month_chart",
  "Implementação de Mecanismos|Tempo até a primeira implementação|Gráfico": "days_to_first_implementation_chart",
  "Implementação de Mecanismos|Dias desde a última implementação|Gráfico": "days_since_last_implementation_chart",
  "Implementação de Mecanismos|Implementados por segmento|Gráfico": "implemented_by_segment_chart",
  "Implementação de Mecanismos|Clientes com mecanismo implementado por EP|Gráfico": "implemented_by_engineer_chart",
};

const PAGE_FILTERS = {
  general: ["status", "segment", "engineer", "program"],
  journey: ["status", "engineer"],
  meetings: ["status", "engineer"],
  patrimonial_plan: [],
  mechanisms: ["status", "engineer", "segment"],
};

const FILTER_ALIAS = {
  client_status: "status",
  search: null,
  hiring_period: null,
  cancellation_period: null,
  stay_range: null,
  mechanismStatus: "mechanism_status",
  hasImplementation: "has_implementation",
};

const PRIMARY_IDS = new Set([
  "active_clients",
  "total_clients",
  "median_stay_days",
  "clients_with_financial_data",
  "attendance_rate",
  "clients_with_meeting",
  "days_since_latest_meeting",
  "no_show_meetings",
  "plan_days_to_approval",
  "implemented_mechanisms",
  "implementation_rate",
  "completed_onboarding_clients",
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((c) => c.trim())) rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return rows.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""])));
}

function sqlString(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return sqlString(JSON.stringify(value ?? []));
}

function dashKidsStatus(raw) {
  const value = String(raw || "").trim();
  return value || null;
}

function isNaoLevar(status) {
  const t = String(status || "").toLowerCase();
  return t.includes("não levar") || t.includes("nao levar");
}

function uiPriority({ dashKids, metricId, metricType }) {
  if (isNaoLevar(dashKids)) return "hidden";
  if (String(dashKids || "").toLowerCase() === "avaliar") return "supporting";
  if (PRIMARY_IDS.has(metricId)) return "primary";
  if (String(metricType || "").toLowerCase().startsWith("gr")) return "secondary";
  if (String(dashKids || "") === "Sim") return "secondary";
  return "supporting";
}

function scopePolicy(pageId, metricId) {
  if (metricId === "client_acquisition_monthly") return "historical";
  if (pageId === "patrimonial_plan") return "historical";
  if (pageId === "cancellations") return "cancelled_population";
  if (pageId === "satisfaction") return "respondents";
  if (pageId === "renewal") return "renewal_eligible";
  if (pageId === "statistical_crosses") return "methodological_population";
  if (["total_clients", "cancelled_clients", "frozen_clients", "non_active_clients", "cancelled_without_confirmed_date"].includes(metricId)) {
    return "all_clients";
  }
  if (VALIDATED_PAGES.has(pageId)) return "active_first";
  return "all_clients";
}

function sourceSystemsFromObjects(objects, extra = []) {
  const set = new Set(extra);
  for (const obj of objects || []) {
    if (obj?.schema === "research" || /acionamento|calendly|agendamento/i.test(obj?.object || obj?.table || "")) {
      set.add("Business Data");
    } else if (obj?.schema === "core" || /pharus/i.test(obj?.system || obj?.object || "")) {
      set.add("App Pharus");
    } else if (obj?.schema === "Agendamentos") {
      set.add("Business Data");
      set.add("Calendly");
    } else {
      set.add("BASE QV");
    }
  }
  if (!set.size) set.add("BASE QV");
  return [...set];
}

function toSourceObjects(v1Sources = [], fallbackText = "") {
  if (Array.isArray(v1Sources) && v1Sources.length) {
    return v1Sources.map((s) => ({
      system: s.schema === "research" || s.schema === "Agendamentos" ? "Business Data" : s.schema === "core" ? "App Pharus" : "BASE QV",
      schema: s.schema || "public",
      object: s.table || s.object,
      column: s.column || null,
    }));
  }
  const text = String(fallbackText || "");
  const objects = [];
  for (const name of ["clients", "cancellations", "client_financial_data", "client_meetings", "manual_meetings", "meeting_attendance", "client_mecanismos", "mecanismos", "client_journeys"]) {
    if (text.includes(name)) objects.push({ system: "BASE QV", schema: "public", object: name });
  }
  if (/calendly/i.test(text)) {
    objects.push({ system: "Business Data", schema: "Agendamentos", object: "calendly_eventos" });
  }
  return objects;
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function looksLikeLiveValue(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^\d/.test(t)) return true;
  if (/\d[\d.,]*\s*%/.test(t)) return true;
  if (/\b(1775|3415|3039)\b/.test(t)) return true;
  return false;
}

function normalizeFilters(list, pageId, extra) {
  if (extra?.accepted_filters) return extra.accepted_filters;
  if (PAGE_FILTERS[pageId]) return PAGE_FILTERS[pageId];
  const mapped = [];
  for (const raw of list || []) {
    const key = String(raw || "").trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(FILTER_ALIAS, key)) {
      if (FILTER_ALIAS[key]) mapped.push(FILTER_ALIAS[key]);
      continue;
    }
    mapped.push(key);
  }
  return unique(mapped);
}

const NEW_METRIC_META = {
  clients_by_segment: {
    description: "Distribuição da carteira filtrada pelos segmentos APEX, PRIVATE, PRINCIPAL, DEBTS, OVER e dados insuficientes.",
    calculation_summary: "Classifica cada cliente pelo segmento calculado a partir dos dados financeiros e conta por categoria.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer", "program"],
  },
  clients_by_status: {
    description: "Distribuição da carteira filtrada pelo status analítico (Ativo, Congelado, Cancelado e variantes).",
    calculation_summary: "Conta clientes por analyticalStatus após a regra consolidada de cancelamento.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer", "program"],
  },
  monthly_income_distribution: {
    description: "Distribuição da renda mensal entre clientes com valor numérico válido.",
    calculation_summary: "Agrupa ultima_renda_mensal válida em faixas; cobertura parcial da carteira.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer"],
  },
  liquidity_reserve_distribution: {
    description: "Distribuição da reserva de liquidez entre clientes com valor numérico válido.",
    calculation_summary: "Agrupa reserva_liquidez válida em faixas; cobertura parcial da carteira.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer"],
  },
  clients_by_engineer: {
    description: "Distribuição de clientes por engenheiro patrimonial.",
    calculation_summary: "Conta clientes distintos por clients.engenheiro_patrimonial no recorte filtrado.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer", "program"],
  },
  client_acquisition_monthly: {
    description: "Clientes adquiridos por mês, independentemente do status atual.",
    calculation_summary: "Conta clientes pela data de contratação (data_inicio_ciclo / created_at). O recorte de ativos da página não se aplica a este gráfico.",
    unit: "clients",
    accepted_filters: ["segment", "engineer", "program"],
    scope_policy: "historical",
  },
  financial_profile_distribution: {
    description: "Perfil patrimonial (imóvel, carro, consórcio e correlatos) entre clientes com diagnóstico financeiro.",
    calculation_summary: "Conta flags financeiras preenchidas na base de client_financial_data.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer"],
  },
  stay_duration_distribution: {
    description: "Distribuição do tempo de permanência em faixas, só com intervalos cronologicamente válidos.",
    calculation_summary: "Usa data de entrada e data analítica de cancelamento ou a data corrente; descarta negativos e datas inválidas.",
    unit: "clients",
    accepted_filters: ["status", "segment", "engineer"],
  },
  days_to_first_meeting_chart: {
    description: "Distribuição dos dias até a primeira reunião na coorte comparável de onboarding.",
    calculation_summary: "Mesma amostra do cartão de mediana até a 1ª reunião; intervalos não negativos.",
    unit: "clients",
  },
  days_to_plan_delivery_chart: {
    description: "Distribuição dos dias até a entrega do plano na coorte comparável de onboarding.",
    calculation_summary: "Mesma amostra do cartão de mediana até entrega do plano.",
    unit: "clients",
  },
  days_to_first_mechanism_chart: {
    description: "Distribuição dos dias até o primeiro mecanismo implementado.",
    calculation_summary: "Mesma amostra do cartão correspondente. Preenchimento retroativo pode distorcer.",
    unit: "clients",
  },
  total_onboarding_time_chart: {
    description: "Distribuição do tempo total de onboarding na coorte comparável.",
    calculation_summary: "Mesma amostra do cartão de mediana de onboarding total.",
    unit: "clients",
  },
  onboarding_completion_chart: {
    description: "Distribuição de quem concluiu ou não o onboarding entre clientes avaliáveis.",
    calculation_summary: "Usa a classificação de conclusão (jornada fechada, primeira reunião ou dado financeiro).",
    unit: "clients",
  },
  meetings_by_month_chart: {
    description: "Reuniões agendadas e realizadas por mês no recorte.",
    calculation_summary: "Conta eventos válidos por mês; meses futuros não entram.",
    unit: "meetings",
  },
  meeting_status_chart: {
    description: "Distribuição de presença: compareceu, no-show, cancelada ou sem confirmação.",
    calculation_summary: "Classifica reuniões analíticas pelo status de attendance.",
    unit: "meetings",
  },
  meeting_frequency_chart: {
    description: "Distribuição de clientes pela quantidade de reuniões válidas.",
    calculation_summary: "Conta reuniões válidas por cliente e agrupa em faixas.",
    unit: "clients",
  },
  days_since_last_meeting_chart: {
    description: "Distribuição dos dias desde a última reunião válida.",
    calculation_summary: "Hoje menos a última reunião válida por cliente, em faixas.",
    unit: "clients",
  },
  meeting_interval_chart: {
    description: "Distribuição do intervalo médio entre presenças confirmadas.",
    calculation_summary: "Mesma lógica do cartão de intervalo; só gaps positivos com presença.",
    unit: "clients",
  },
  noshow_frequency_chart: {
    description: "Clientes do recorte por quantidade de no-shows.",
    calculation_summary: "Conta faltas elegíveis por cliente. Pode distorcer se o EP não registrar no-show.",
    unit: "clients",
  },
  meetings_by_engineer_chart: {
    description: "Reuniões do recorte por engenheiro patrimonial.",
    calculation_summary: "Soma reuniões válidas agrupadas pelo EP do cliente.",
    unit: "meetings",
  },
  plan_status_chart: {
    description: "Distribuição por presença de reunião Central de Inteligência (proxy de status do plano).",
    calculation_summary: "Classifica clientes segundo reunião Central. Indicador não levado na V2.",
    unit: "clients",
  },
  mechanism_status_chart: {
    description: "Distribuição dos vínculos deduplicados por status (Apto, Em andamento, Implementado, Não informado).",
    calculation_summary: "Após dedupe client_id+mecanismo_id, conta vínculos por status normalizado.",
    unit: "links",
  },
  mechanisms_per_client_chart: {
    description: "Quantidade de mecanismos por cliente com vínculo.",
    calculation_summary: "Faixas 1–4 e 5 ou mais sobre clientes com pelo menos um vínculo.",
    unit: "clients",
  },
  catalog_coverage_chart: {
    description: "Tipos do catálogo utilizados versus sem utilização.",
    calculation_summary: "Distinct mecanismo_id presentes no catálogo versus tipos sem nenhum vínculo.",
    unit: "types",
  },
  mechanism_type_usage_chart: {
    description: "Utilização por tipo de mecanismo (vínculos).",
    calculation_summary: "Conta vínculos deduplicados por mecanismo.",
    unit: "links",
  },
  implementations_by_month_chart: {
    description: "Implementações por mês com implemented_at ≤ agora.",
    calculation_summary: "Conta vínculos Implementado com data válida. Datas podem ser retroativas.",
    unit: "links",
  },
  days_to_first_implementation_chart: {
    description: "Distribuição do tempo até a primeira implementação.",
    calculation_summary: "Não levado na V2 (Dash Kids).",
    unit: "clients",
  },
  days_since_last_implementation_chart: {
    description: "Distribuição dos dias desde a última implementação.",
    calculation_summary: "Não levado na V2 (Dash Kids).",
    unit: "clients",
  },
  implemented_by_segment_chart: {
    description: "Mecanismos implementados por segmento.",
    calculation_summary: "Soma vínculos implementados agrupados pelo segmento do cliente.",
    unit: "links",
  },
  implemented_by_engineer_chart: {
    description: "Clientes com pelo menos um mecanismo implementado, sobre a carteira do EP.",
    calculation_summary: "Numerador = clientes com implemented > 0; denominador = carteira do EP no recorte de status/segmento.",
    unit: "clients",
  },
};

function populationFor(pageId, scope) {
  if (scope === "historical") return "População histórica aplicável; não restringir automaticamente a ativos.";
  if (scope === "cancelled_population") return "População de cancelados / processo de cancelamento.";
  if (scope === "respondents") return "Universo de respondentes.";
  if (scope === "renewal_eligible") return "Elegíveis à renovação.";
  if (scope === "methodological_population") return "População metodológica (ativos + cancelados).";
  if (scope === "all_clients") return "Carteira completa do recorte, sem forçar ativos.";
  if (scope === "active_first") return "Default Ativos (analyticalStatus = Ativo). Congelado não é ativo.";
  return "População do recorte filtrado.";
}

const { portalMetricCatalog } = await import(pathToFileURL(V1_CATALOG).href);
const CSV_PATH = CSV_CANDIDATES.find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});
if (!CSV_PATH) throw new Error("CSV de confiabilidade não encontrado.");
const csvRows = parseCsv(readFileSync(CSV_PATH, "utf8"));
const v1ById = new Map();
for (const [key, entry] of Object.entries(portalMetricCatalog)) {
  if (!entry || typeof entry !== "object" || !entry.id || !entry.label) continue;
  v1ById.set(entry.id, entry);
}

const usedV1 = new Set();
const metrics = [];
const mappingNotes = [];

for (const row of csvRows) {
  const pageName = String(row["Página do dashboard"] || "").trim();
  const label = String(row["Cartão / gráfico"] || "").trim();
  const metricType = String(row.Tipo || "").trim();
  const dashKids = dashKidsStatus(row["Dash Kids"]);
  const page = PAGE_MAP[pageName];
  if (!page || !label) {
    mappingNotes.push({ kind: "csv_unmapped_page", pageName, label });
    continue;
  }
  const key = `${pageName}|${label}|${metricType}`;
  const metricId = CSV_IDS[key];
  if (!metricId) {
    mappingNotes.push({ kind: "csv_missing_id", key });
    continue;
  }
  const v1 = v1ById.get(metricId) || null;
  if (v1) usedV1.add(metricId);
  const extra = NEW_METRIC_META[metricId] || {};
  const sourceObjects = toSourceObjects(v1?.sources, row.Fonte);
  const systems = sourceSystemsFromObjects(sourceObjects, /calendly/i.test(row.Fonte) ? ["Calendly", "Business Data"] : []);
  const limitations = unique([
    ...(Array.isArray(v1?.caveats) ? v1.caveats : []),
    ...(Array.isArray(v1?.limitations) ? v1.limitations : []),
    row.Observações,
    String(row["Campos ausentes / causa do descarte"] || "").startsWith("Nenhum")
      ? null
      : row["Campos ausentes / causa do descarte"],
  ]).filter((t) => t && !looksLikeLiveValue(t));
  const scope = extra.scope_policy || scopePolicy(page.id, metricId);
  metrics.push({
    metric_id: metricId,
    page_id: page.id,
    page_label: page.label,
    label,
    description: v1?.description || extra.description || row["Regra / critério de inclusão"] || null,
    metric_type: metricType.toLowerCase().startsWith("gr") ? "chart" : "card",
    unit: v1?.unit || extra.unit || null,
    dash_kids_status: dashKids,
    validated_for_v2: VALIDATED_PAGES.has(page.id) && dashKids === "Sim",
    scope_policy: scope,
    population_description: populationFor(page.id, scope),
    calculation_summary: extra.calculation_summary || v1?.formula || row["Regra / critério de inclusão"] || null,
    source_systems: systems,
    source_objects: sourceObjects,
    accepted_filters: normalizeFilters(v1?.supportedFilters, page.id, extra),
    aliases: unique([...(v1?.aliases || []), ...(v1?.questions || [])]).slice(0, 12),
    limitations,
    ui_priority: uiPriority({ dashKids, metricId, metricType }),
    v1_reference: v1 ? `portal-metric-catalog.mjs#${metricId}` : null,
    csv_reference: `confiabilidade-indicadores - Página1 (1).csv | ${pageName} | ${label} | ${metricType}`,
  });
}

for (const [id, entry] of v1ById.entries()) {
  if (usedV1.has(id)) continue;
  const page = DOMAIN_PAGE[entry.domain] || DOMAIN_PAGE[entry.page] || {
    id: entry.domain || "unknown",
    label: entry.domain || "Não mapeado",
  };
  const sourceObjects = toSourceObjects(entry.sources);
  metrics.push({
    metric_id: id,
    page_id: page.id,
    page_label: page.label,
    label: entry.label,
    description: entry.description || null,
    metric_type: entry.aggregation === "top" || entry.distributionLookup ? "chart" : "card",
    unit: entry.unit || null,
    dash_kids_status: null,
    validated_for_v2: false,
    scope_policy: scopePolicy(page.id, id),
    population_description: populationFor(page.id, scopePolicy(page.id, id)),
    calculation_summary: entry.formula || entry.description || null,
    source_systems: sourceSystemsFromObjects(sourceObjects),
    source_objects: sourceObjects,
    accepted_filters: normalizeFilters(entry.supportedFilters, page.id),
    aliases: unique([...(entry.aliases || []), ...(entry.questions || [])]).slice(0, 12),
    limitations: unique([...(entry.caveats || []), ...(entry.limitations || []), "Presente na V1 e ausente do CSV Dash Kids; não promovida na V2."]),
    ui_priority: "hidden",
    v1_reference: `portal-metric-catalog.mjs#${id}`,
    csv_reference: null,
  });
}

metrics.sort((a, b) => a.page_id.localeCompare(b.page_id) || a.metric_id.localeCompare(b.metric_id));

const byId = new Map();
const duplicates = [];
for (const m of metrics) {
  if (byId.has(m.metric_id)) duplicates.push(m.metric_id);
  byId.set(m.metric_id, m);
}
const uniqueMetrics = [...byId.values()];

const sqlLines = [
  "-- Seed idempotente do catálogo analítico V2.",
  "-- Destino: Business Data.analytics.metric_catalog",
  "-- Gerado por scripts/generate-metric-catalog-seed.mjs",
  "",
  "INSERT INTO analytics.metric_catalog (",
  "  metric_id, page_id, page_label, label, description, metric_type, unit,",
  "  dash_kids_status, validated_for_v2, scope_policy, population_description,",
  "  calculation_summary, source_systems, source_objects, accepted_filters, aliases,",
  "  limitations, ui_priority, v1_reference, csv_reference, updated_at",
  ") VALUES",
];
sqlLines.push(
  uniqueMetrics
    .map((m) => `(
  ${sqlString(m.metric_id)},
  ${sqlString(m.page_id)},
  ${sqlString(m.page_label)},
  ${sqlString(m.label)},
  ${sqlString(m.description)},
  ${sqlString(m.metric_type)},
  ${sqlString(m.unit)},
  ${sqlString(m.dash_kids_status)},
  ${m.validated_for_v2 ? "true" : "false"},
  ${sqlString(m.scope_policy)},
  ${sqlString(m.population_description)},
  ${sqlString(m.calculation_summary)},
  ${sqlJson(m.source_systems)}::jsonb,
  ${sqlJson(m.source_objects)}::jsonb,
  ${sqlJson(m.accepted_filters)}::jsonb,
  ${sqlJson(m.aliases)}::jsonb,
  ${sqlJson(m.limitations)}::jsonb,
  ${sqlString(m.ui_priority)},
  ${sqlString(m.v1_reference)},
  ${sqlString(m.csv_reference)},
  now()
)`)
    .join(",\n"),
);
sqlLines.push(`
ON CONFLICT (metric_id) DO UPDATE SET
  page_id = EXCLUDED.page_id,
  page_label = EXCLUDED.page_label,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  metric_type = EXCLUDED.metric_type,
  unit = EXCLUDED.unit,
  dash_kids_status = EXCLUDED.dash_kids_status,
  validated_for_v2 = EXCLUDED.validated_for_v2,
  scope_policy = EXCLUDED.scope_policy,
  population_description = EXCLUDED.population_description,
  calculation_summary = EXCLUDED.calculation_summary,
  source_systems = EXCLUDED.source_systems,
  source_objects = EXCLUDED.source_objects,
  accepted_filters = EXCLUDED.accepted_filters,
  aliases = EXCLUDED.aliases,
  limitations = EXCLUDED.limitations,
  ui_priority = EXCLUDED.ui_priority,
  v1_reference = EXCLUDED.v1_reference,
  csv_reference = EXCLUDED.csv_reference,
  updated_at = now();
`);

mkdirSync(join(ROOT, "sql", "analytics"), { recursive: true });
writeFileSync(join(ROOT, "sql", "analytics", "002_seed_metric_catalog.sql"), sqlLines.join("\n"), "utf8");
writeFileSync(join(ROOT, "lib", "analytics", "metric-catalog-seed.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
    csvPath: "sql/analytics/source/confiabilidade-indicadores-pagina1.csv",
  csvRows: csvRows.length,
  mappingNotes,
  duplicates,
  metrics: uniqueMetrics,
}, null, 2), "utf8");

const dash = (status) => uniqueMetrics.filter((m) => m.dash_kids_status === status).length;
console.log(JSON.stringify({
  csvRows: csvRows.length,
  csvMapped: uniqueMetrics.filter((m) => m.csv_reference).length,
  v1Only: uniqueMetrics.filter((m) => !m.csv_reference).length,
  total: uniqueMetrics.length,
  sim: dash("Sim"),
  avaliar: dash("Avaliar"),
  naoLevar: uniqueMetrics.filter((m) => isNaoLevar(m.dash_kids_status)).length,
  validated: uniqueMetrics.filter((m) => m.validated_for_v2).length,
  duplicates,
  missingId: mappingNotes.filter((n) => n.kind === "csv_missing_id"),
  withoutRule: uniqueMetrics.filter((m) => !m.calculation_summary).map((m) => m.metric_id),
  withoutSource: uniqueMetrics.filter((m) => !(m.source_systems || []).length).map((m) => m.metric_id),
  byPage: Object.fromEntries(
    [...new Set(uniqueMetrics.map((m) => m.page_id))].sort().map((p) => [p, uniqueMetrics.filter((m) => m.page_id === p).length]),
  ),
}, null, 2));
