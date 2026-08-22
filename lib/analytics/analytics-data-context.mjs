/**
 * Contexto read-only por request — deduplica fetches REST idênticos via Promise memoizada.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { fetchAllRowsImpl } from "../data/supabase-rest.mjs";
import { ANALYTICAL_CANCEL_SELECT } from "./analytical-cancellation.mjs";
import { CANCELLATION_PROCESS_SELECT } from "./cancellation-process.mjs";

const storage = new AsyncLocalStorage();

function mergeSelectColumns(...selects) {
  const cols = new Set();
  for (const select of selects) {
    for (const col of String(select || "").split(",")) {
      const trimmed = col.trim();
      if (trimmed) cols.add(trimmed);
    }
  }
  return [...cols].join(",");
}

/** Selects superset por tabela — dedup ignora subconjuntos na mesma request. */
const CANONICAL_SELECT = {
  clients:
    "id,codigo,name,email,phone,cpf,cpf_digits,phone_digits,linked_user_id,status,segmentacao,engenheiro_patrimonial,programa,data_inicio_ciclo,data_fim_ciclo,created_at,data_churn,motivo_churn,ciclo,valor_total_pago,contrato_assinado,davos_contrato_assinado",
  cancellations: mergeSelectColumns(CANCELLATION_PROCESS_SELECT, ANALYTICAL_CANCEL_SELECT),
  client_financial_data: mergeSelectColumns(
    "id,client_id,reserva_liquidez,ultima_renda_mensal,ultimo_aporte,possui_imovel,possui_carro,possui_consorcio,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,valor_imoveis_quitados,created_at,updated_at",
  ),
  client_meetings:
    "id,client_id,calendly_event_uri,event_name,start_time,end_time,host_email,manually_linked",
  manual_meetings:
    "id,client_id,title,start_time,end_time,google_event_id,recurrence_group_id",
  meeting_attendance:
    "calendly_event_uri,status,remarcado,link_gravacao,updated_at,created_at",
  client_mecanismos:
    "id,client_id,mecanismo_id,status,implemented_at,created_at,no_plano,sequence,valor_aplicado,source",
  client_journeys:
    "id,client_id,current_stage_id,started_at,created_at",
  client_implementation_meeting_date: "client_id,meeting_date,source",
  nps_responses:
    "id,typeform_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,raw_payload,created_at",
  csat_responses:
    "id,typeform_response_id,form_response_id,typeform_form_id,client_id,client_name,client_email,tipo_de_forms,score,comment,raw_payload,created_at,meeting_date",
  nps_sends: "id,client_id,sent_at,created_at",
  cancellation_statuses: "id,name,color,display_order,status_type,funnel_type,created_at",
  mecanismos: "id,name,categoria,mercado,programa,status,codigo",
};

function normalizeFetchOpts(opts = {}) {
  const canonical = CANONICAL_SELECT[opts.table];
  if (!canonical) return opts;
  const next = { ...opts, select: canonical };
  if (opts.table === "client_implementation_meeting_date") {
    next.order = "client_id.asc";
  } else if (opts.table === "cancellation_statuses") {
    next.order = "display_order.asc";
  } else if (
    ["clients", "client_meetings", "manual_meetings", "client_financial_data", "client_mecanismos", "cancellations", "client_journeys", "nps_responses", "csat_responses", "nps_sends"].includes(
      opts.table,
    )
  ) {
    next.order = "id.asc";
  }
  return next;
}

function fetchKey(opts = {}) {
  const normalized = normalizeFetchOpts(opts);
  return JSON.stringify({
    table: normalized.table,
    select: normalized.select,
    order: normalized.order ?? "id.asc",
    filters: normalized.filters ?? null,
    schema: normalized.schema ?? "public",
  });
}

export function getAnalyticsDataContext() {
  return storage.getStore() || null;
}

export function runWithAnalyticsDataContext(fn, options = {}) {
  const existing = storage.getStore();
  if (existing && options.reuseParent !== false) {
    return fn();
  }
  const ctx = createAnalyticsDataContext(options);
  return storage.run(ctx, fn);
}

export function createAnalyticsDataContext(options = {}) {
  const perfDebug = Boolean(options.perfDebug);
  const page = options.page || "unknown";
  const promises = new Map();
  const sources = new Map();

  async function trackedFetch(opts) {
    const key = fetchKey(opts);
    if (promises.has(key)) {
      const hit = sources.get(key);
      if (hit) hit.dedup_hits += 1;
      return promises.get(key);
    }

    const started = Date.now();
    const stat = {
      source: opts.table,
      select: opts.select,
      dedup_hits: 0,
      request_count: 0,
      total_rows: 0,
      fetch_ms: 0,
    };
    sources.set(key, stat);

    const promise = fetchAllRowsImpl(normalizeFetchOpts(opts))
      .then((rows) => {
        stat.fetch_ms = Date.now() - started;
        stat.total_rows = rows.length;
        const pageSize = Number(process.env.DATA_REST_PAGE_SIZE || 1000) || 1000;
        stat.request_count = Math.max(1, Math.ceil(rows.length / pageSize));
        return rows;
      })
      .catch((err) => {
        promises.delete(key);
        sources.delete(key);
        throw err;
      });

    promises.set(key, promise);
    return promise;
  }

  const ctx = {
    page,
    perfDebug,
    fetchAllRows: trackedFetch,
    getClients: (select, extra = {}) => trackedFetch({ table: "clients", select, ...extra }),
    getCancellations: (select, extra = {}) => trackedFetch({ table: "cancellations", select, ...extra }),
    getFinancial: (select, extra = {}) => trackedFetch({ table: "client_financial_data", select, ...extra }),
    getCalendlyMeetings: (select, extra = {}) => trackedFetch({ table: "client_meetings", select, ...extra }),
    getManualMeetings: (select, extra = {}) => trackedFetch({ table: "manual_meetings", select, ...extra }),
    getMeetingAttendance: (select, extra = {}) => trackedFetch({ table: "meeting_attendance", select, ...extra }),
    getMechanismsCatalog: (select, extra = {}) => trackedFetch({ table: "mecanismos", select, ...extra }),
    getClientMechanisms: (select, extra = {}) => trackedFetch({ table: "client_mecanismos", select, ...extra }),
    getNpsResponses: (select, extra = {}) => trackedFetch({ table: "nps_responses", select, ...extra }),
    getCsatResponses: (select, extra = {}) => trackedFetch({ table: "csat_responses", select, ...extra }),
    getNpsSends: (select, extra = {}) => trackedFetch({ table: "nps_sends", select, ...extra }),
    getClientJourneys: (select, extra = {}) => trackedFetch({ table: "client_journeys", select, ...extra }),
    getClientImplementationMeetings: (select, extra = {}) =>
      trackedFetch({ table: "client_implementation_meeting_date", select, order: "client_id.asc", ...extra }),
    getCancellationStatuses: (select, extra = {}) =>
      trackedFetch({ table: "cancellation_statuses", select, order: "display_order.asc", ...extra }),
    snapshot() {
      return [...sources.values()].map((s) => ({
        source: s.source,
        request_count: s.request_count,
        dedup_hits: s.dedup_hits,
        total_rows: s.total_rows,
        fetch_ms: s.fetch_ms,
      }));
    },
    logPerf(extra = {}) {
      if (!perfDebug) return;
      const rows = ctx.snapshot().sort((a, b) => b.fetch_ms - a.fetch_ms);
      const totalFetchMs = rows.length ? Math.max(...rows.map((r) => r.fetch_ms)) : 0;
      const totalRequests = rows.reduce((a, r) => a + r.request_count, 0);
      console.info(
        `[Perf][${page}] total_ms=${extra.total_ms ?? "—"} fetch_ms=${totalFetchMs} requests=${totalRequests} compute_ms=${extra.compute_ms ?? "—"} payload_bytes=${extra.payload_bytes ?? "—"}`,
      );
      if (extra.core) {
        const core = extra.core;
        console.info(
          `[Perf][${page}] core preload_ms=${core.preload_ms ?? "—"} general_core_ms=${core.general_core_ms ?? "—"} journey_core_ms=${core.journey_core_ms ?? "—"} meetings_core_ms=${core.meetings_core_ms ?? "—"} mechanisms_core_ms=${core.mechanisms_core_ms ?? "—"} satisfaction_core_ms=${core.satisfaction_core_ms ?? "—"} cancellations_core_ms=${core.cancellations_core_ms ?? "—"} renewal_core_ms=${core.renewal_core_ms ?? "—"} ep_core_ms=${core.ep_core_ms ?? "—"} temporal_core_ms=${core.temporal_core_ms ?? "—"} financial_core_ms=${core.financial_core_ms ?? "—"}`,
        );
      }
      for (const row of rows) {
        console.info(
          `[Perf][${page}] ${row.source} requests=${row.request_count} dedup_hits=${row.dedup_hits} rows=${row.total_rows} fetch_ms=${row.fetch_ms}`,
        );
      }
    },
  };

  return ctx;
}

export function perfDebugFromRequest(request) {
  if (!request?.url) return false;
  try {
    const url = new URL(request.url, "http://localhost");
    return url.searchParams.get("perfDebug") === "1";
  } catch {
    return false;
  }
}

export function perfDebugFromOptions(options = {}) {
  if (options.perfDebug === true) return true;
  if (process.env.ANALYTICS_PERF_DEBUG === "1") return true;
  return false;
}
