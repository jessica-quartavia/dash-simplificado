/**
 * Computes V1 read-only para auditoria — sem alterar handlers Netlify.
 */
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchAllRows } from "../data/supabase-rest.mjs";
import { excludedClientIds, filterExcludedClients } from "./data-exclusions.mjs";
import {
  ANALYTICAL_CANCEL_SELECT,
} from "./analytical-cancellation.mjs";
import { buildRenewalPayload } from "./renewal.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const V1_FUNCTIONS = resolve(ROOT, "../analytics_jornada_cliente/analytics_jornada_cliente/netlify/functions");
const V1_SHARED = join(V1_FUNCTIONS, "_shared");

async function importV1Shared(name) {
  return import(pathToFileURL(join(V1_SHARED, name)).href);
}

const CLIENT_SELECT_RENEWAL =
  "id,codigo,name,status,engenheiro_patrimonial,programa,data_inicio_ciclo,data_fim_ciclo,ciclo";
const FINANCIAL_SELECT =
  "id,client_id,ultima_renda_mensal,reserva_liquidez,ultimo_aporte,valor_imoveis_quitados,cheque_especial,parcelamento_cartao,credito_pessoal,credito_consignado,updated_at";

/** V1 renewal: regra em _shared/client-cycle-renewal.mjs (sem renewal.mjs standalone). */
export async function computeV1RenewalPayload() {
  await importV1Shared("client-cycle-renewal.mjs");
  const [clientsRaw, cancellations, financialRows] = await Promise.all([
    fetchAllRows({ table: "clients", select: CLIENT_SELECT_RENEWAL }),
    fetchAllRows({ table: "cancellations", select: ANALYTICAL_CANCEL_SELECT }),
    fetchAllRows({ table: "client_financial_data", select: FINANCIAL_SELECT }),
  ]);
  const removedIds = excludedClientIds(clientsRaw);
  const clients = filterExcludedClients(clientsRaw);
  const keepClient = (row) => !removedIds.has(String(row?.client_id || ""));
  return buildRenewalPayload({
    clients,
    cancellations: cancellations.filter(keepClient),
    financialRows: financialRows.filter(keepClient),
  });
}

/** V1 satisfaction handler não exporta compute — port V2 (mesma lógica BASE QV). */
export async function computeV1SatisfactionPayload() {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/satisfaction.mjs")).href);
  return mod.computeSatisfactionPayload();
}

/** V1 patrimonial-plan handler não exporta compute — port V2 (mesma lógica BASE QV). */
export async function computeV1PatrimonialPlanPayload(options = {}) {
  const mod = await import(pathToFileURL(join(ROOT, "lib/analytics/patrimonial-plan.mjs")).href);
  return mod.computePatrimonialPlanPayload(options);
}

/** V1 temporal indicators — handler Netlify exporta computeTemporalIndicatorsPayload. */
export async function computeV1TemporalIndicatorsPayload() {
  const mod = await import(pathToFileURL(join(V1_FUNCTIONS, "temporal-indicators.mjs")).href);
  return mod.computeTemporalIndicatorsPayload();
}

/**
 * V1 platform-usage: handler inline + auth + metrics.events + auth.users.
 * Executa corpo do compute sem HTTP auth (runner interno).
 */
export async function computeV1PlatformUsagePayload() {
  const { getPharusSupabaseClient, getPharusEnv } = await importV1Shared("env.mjs");
  const { isPharusDemoEmail } = await import(pathToFileURL(join(V1_FUNCTIONS, "_shared/pharus-demo-filter.mjs")).href);

  const warnings = [];
  let pharusEvents = [];
  try {
    const client = getPharusSupabaseClient({ schema: "metrics" });
    const pageSize = 1000;
    for (let offset = 0; offset < 200000; offset += pageSize) {
      const page = await client.rest("events", {
        select: "id,origin,event_name,created_at,metadata",
        filters: { event_name: "in.(login_succeeded,login_success)", order: "id.asc" },
        limit: pageSize,
        offset,
      });
      if (!page.ok) throw new Error(`metrics.events HTTP ${page.status}`);
      pharusEvents.push(...page.data);
      if (page.data.length < pageSize) break;
    }
  } catch (error) {
    warnings.push({
      code: "PHARUS_METRICS_AUTH",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let personalInfoRows = [];
  try {
    const client = getPharusSupabaseClient({ schema: "core" });
    personalInfoRows = await client.fetchAll("personal_info", "user_id,name,alternative_email,phone", {
      pageSize: 1000,
      maxRows: 200000,
    });
  } catch (error) {
    warnings.push({ code: "PHARUS_PERSONAL_INFO", message: error instanceof Error ? error.message : String(error) });
  }

  let authUserRows = [];
  const pharusEnv = getPharusEnv();
  if (!pharusEnv.serviceRoleKey) {
    warnings.push({ code: "PHARUS_AUTH_USERS", message: "service role ausente para auth.users" });
  } else {
    try {
      const perPage = 1000;
      for (let page = 1; page <= 200; page += 1) {
        const endpoint = new URL("/auth/v1/admin/users", pharusEnv.url);
        endpoint.searchParams.set("page", String(page));
        endpoint.searchParams.set("per_page", String(perPage));
        const response = await fetch(endpoint, {
          headers: {
            apikey: pharusEnv.serviceRoleKey,
            Authorization: `Bearer ${pharusEnv.serviceRoleKey}`,
            Accept: "application/json",
          },
        });
        if (!response.ok) throw new Error(`auth.users HTTP ${response.status}`);
        const payload = await response.json().catch(() => ({}));
        const batch = Array.isArray(payload.users) ? payload.users : [];
        authUserRows.push(...batch);
        if (batch.length < perPage) break;
      }
    } catch (error) {
      warnings.push({ code: "PHARUS_AUTH_USERS", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const isCorporateEmail = (value) => String(value || "").trim().toLowerCase().endsWith("@quartavia.com.br");
  const authUsersById = new Map(
    authUserRows.map((row) => {
      const metadata = row.user_metadata && typeof row.user_metadata === "object" ? row.user_metadata : {};
      return [
        String(row.id),
        { email: String(row.email || metadata.email || "").trim(), name: String(metadata.name || metadata.full_name || "").trim() },
      ];
    }),
  );
  const corporateUserIds = new Set(
    [...authUsersById.entries()].filter(([, u]) => isCorporateEmail(u.email)).map(([id]) => id),
  );
  const demoUserIds = new Set(
    [...authUsersById.entries()].filter(([, u]) => isPharusDemoEmail(u.email)).map(([id]) => id),
  );

  const eventClientId = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return String(row?.user_id || meta?.user_id || meta?.userId || "");
  };

  const eligibleEvents = pharusEvents.filter((event) => {
    const userId = eventClientId(event);
    return userId && !corporateUserIds.has(userId) && !demoUserIds.has(userId);
  });

  const byUser = new Map();
  for (const event of eligibleEvents) {
    const id = eventClientId(event);
    if (!id) continue;
    if (!byUser.has(id)) byUser.set(id, { totalLogins: 0, daysSinceLastAccess: null });
    byUser.get(id).totalLogins += 1;
  }
  const clients = [...byUser.values()];
  const totalLogins = clients.reduce((sum, c) => sum + c.totalLogins, 0);
  const totalUsers = byUser.size;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers,
      totalLogins,
      typicalDaysSinceLastAccess: null,
      eventsLoaded: pharusEvents.length,
      eligibleEvents: eligibleEvents.length,
    },
    sources: { warnings },
    _auditSources: {
      metricsEvents: pharusEvents.length,
      personalInfoRows: personalInfoRows.length,
      authUsers: authUserRows.length,
    },
  };
}
