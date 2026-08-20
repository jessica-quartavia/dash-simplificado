/**
 * Diagnóstico somente leitura: clientes analiticamente ativos V1 × V2.
 *
 * - Uma única leitura GET da BASE QV (clients + cancellations).
 * - Classifica com o kernel da V2 e com o kernel real da V1 (import).
 * - Não escreve no banco. Não altera a aplicação. Não imprime segredos.
 *
 * Uso: node scripts/compare-active-v1-v2-readonly.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchAllRows } from "../lib/data/supabase-rest.mjs";
import * as v2Cancel from "../lib/analytics/analytical-cancellation.mjs";
import * as v2Exclusions from "../lib/analytics/data-exclusions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V1_ROOT = resolve(ROOT, "..", "analytics_jornada_cliente", "analytics_jornada_cliente");
const V1_CANCEL_PATH = join(V1_ROOT, "netlify", "functions", "_shared", "analytical-cancellation.mjs");
const V1_EXCL_PATH = join(V1_ROOT, "netlify", "functions", "_shared", "data-exclusions.mjs");

const CLIENT_SELECT_PROD =
  "id,codigo,name,data_inicio_ciclo,data_fim_ciclo,created_at,status,segmentacao,engenheiro_patrimonial,data_churn,ciclo,programa,valor_total_pago,contrato_assinado,davos_contrato_assinado";
const CLIENT_SELECT_DIAG =
  `${CLIENT_SELECT_PROD},email,alternative_email`;
const CANCEL_SELECT =
  "id,client_id,churn_efetivado_at,distrato_assinado_at,distrato,data_pedido,intencao_registrada_at,archived_at,updated_at,created_at";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const merged = {
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
};
for (const [key, value] of Object.entries(merged)) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function jsonSafe(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function classifyPopulation(clients, cancellations, cancelMod, exclMod) {
  const before = clients.length;
  const removed = (clients || []).filter((row) => exclMod.isExcludedClient(row));
  const kept = exclMod.filterExcludedClients(clients);
  const removedIds = exclMod.excludedClientIds(clients);
  const keptCancels = (cancellations || []).filter((row) => !removedIds.has(String(row.client_id || "")));
  const built = cancelMod.buildAnalyticalCancellationMap(keptCancels, kept);
  const active = [];
  const records = new Map();

  for (const client of kept) {
    const id = String(client.id);
    const cancelInfo = built.map.get(id) || null;
    const rawStatus = client.status ?? null;
    const normalizedRaw = cancelMod.normalizeClientStatus(rawStatus);
    const analyticalStatus = cancelMod.resolveAnalyticalStatusFromMaps(rawStatus, cancelInfo);
    const rec = {
      client_id: id,
      codigo: client.codigo ?? null,
      nome: client.name ?? null,
      programa: client.programa ?? null,
      status_bruto: rawStatus,
      status_bruto_normalizado: normalizedRaw,
      status_analitico: analyticalStatus,
      motivo: cancelInfo?.stage || cancelInfo?.motivo || null,
      cancellation_source: cancelInfo?.source || cancelInfo?.dateSource || null,
      hasConfirmedDate: Boolean(cancelInfo?.hasConfirmedDate && cancelInfo?.date),
      data_churn: client.data_churn ?? null,
      churn_efetivado_at: cancelInfo?.hasChurnEfetivado ? iso(cancelInfo.date) : null,
      cancellation_date: iso(cancelInfo?.date),
      cancellation_row_id: cancelInfo?.cancellationRowId || null,
      sourcesMatched: cancelInfo?.sourcesMatched || [],
    };
    records.set(id, rec);
    if (analyticalStatus === "Ativo") active.push(rec);
  }

  return {
    beforeExclusions: before,
    removedCount: removed.length,
    removed: removed.map((row) => ({
      client_id: String(row.id),
      codigo: row.codigo ?? null,
      nome: row.name ?? null,
      email: row.email ?? row.alternative_email ?? null,
    })),
    afterExclusions: kept.length,
    multiples: [...built.multiples],
    activeCount: active.length,
    active,
    records,
    cancelMap: built.map,
    audit: built.audit,
  };
}

function rowsForClient(cancellations, clientId) {
  return (cancellations || []).filter((row) => String(row.client_id) === String(clientId));
}

function describeCancelRows(rows, cancelMod) {
  return rows.map((row) => {
    const parsed = cancelMod.getAnalyticalCancellation(row);
    return {
      cancellation_id: row.id ?? null,
      archived_at: row.archived_at ?? null,
      archived_parsed: Boolean(cancelMod.parseFlexibleDate(row.archived_at)),
      churn_efetivado_at: row.churn_efetivado_at ?? null,
      distrato_assinado_at: row.distrato_assinado_at ?? null,
      distrato: row.distrato ?? null,
      distrato_json: JSON.stringify(row.distrato),
      distrato_is_assinado: cancelMod.isDistratoTextSigned(row.distrato),
      data_pedido: row.data_pedido ?? null,
      intencao_registrada_at: row.intencao_registrada_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      would_effectivate: parsed.isCancelled,
      source_if_alone: parsed.source,
    };
  });
}

function explainClient(id, v1, v2, cancellations, clientsById) {
  const client = clientsById.get(id) || {};
  const v1Rec = v1.records.get(id);
  const v2Rec = v2.records.get(id);
  const rows = rowsForClient(cancellations, id);
  return {
    client_id: id,
    codigo: client.codigo ?? v1Rec?.codigo ?? v2Rec?.codigo ?? null,
    nome: client.name ?? v1Rec?.nome ?? v2Rec?.nome ?? null,
    programa: client.programa ?? null,
    status_bruto: client.status ?? null,
    status_bruto_normalizado_v1: v1Rec?.status_bruto_normalizado ?? null,
    status_bruto_normalizado_v2: v2Rec?.status_bruto_normalizado ?? null,
    v1: v1Rec
      ? { status_analitico: v1Rec.status_analitico, motivo: v1Rec.motivo, source: v1Rec.cancellation_source }
      : { status_analitico: null, motivo: "ausente após exclusões/fetch V1" },
    v2: v2Rec
      ? { status_analitico: v2Rec.status_analitico, motivo: v2Rec.motivo, source: v2Rec.cancellation_source }
      : { status_analitico: null, motivo: "ausente após exclusões/fetch V2" },
    evidencias: {
      data_churn: client.data_churn ?? null,
      cancellation_rows: describeCancelRows(rows, v2Cancel),
      multiple_cancellations: rows.length > 1,
      any_archived: rows.some((row) => Boolean(v2Cancel.parseFlexibleDate(row.archived_at))),
      any_non_archived: rows.some((row) => !v2Cancel.parseFlexibleDate(row.archived_at)),
    },
  };
}

const v1Cancel = existsSync(V1_CANCEL_PATH)
  ? await import(pathToFileURL(V1_CANCEL_PATH).href)
  : null;
const v1Excl = existsSync(V1_EXCL_PATH)
  ? await import(pathToFileURL(V1_EXCL_PATH).href)
  : null;

if (!v1Cancel || !v1Excl) {
  console.error("Não foi possível importar o kernel da V1 em", V1_ROOT);
  process.exit(1);
}

const dataUrl = String(process.env.DATA_SUPABASE_URL || "").replace(/\/$/, "");
const projectRef = dataUrl.replace(/^https:\/\//, "").split(".")[0] || "(ausente)";
console.log(`[diag] BASE QV projeto=${projectRef} GET-only started=${new Date().toISOString()}`);

let clients;
let clientSelectUsed = CLIENT_SELECT_DIAG;
try {
  clients = await fetchAllRows({ table: "clients", select: CLIENT_SELECT_DIAG });
} catch (error) {
  console.warn("[diag] select com e-mail falhou; repetindo select de produção.", error instanceof Error ? error.message : error);
  clientSelectUsed = CLIENT_SELECT_PROD;
  clients = await fetchAllRows({ table: "clients", select: CLIENT_SELECT_PROD });
}
const cancellations = await fetchAllRows({ table: "cancellations", select: CANCEL_SELECT });

const clientsById = new Map(clients.map((row) => [String(row.id), row]));
const v2 = classifyPopulation(clients, cancellations, v2Cancel, v2Exclusions);
const v1 = classifyPopulation(clients, cancellations, v1Cancel, v1Excl);

const activeV1 = new Set(v1.active.map((row) => row.client_id));
const activeV2 = new Set(v2.active.map((row) => row.client_id));
const onlyV1 = [...activeV1].filter((id) => !activeV2.has(id)).sort();
const onlyV2 = [...activeV2].filter((id) => !activeV1.has(id)).sort();

const kernelsIdentical =
  v1.activeCount === v2.activeCount
  && onlyV1.length === 0
  && onlyV2.length === 0
  && v1.removedCount === v2.removedCount;

const distratoValues = [...new Set(
  cancellations.map((row) => JSON.stringify(row.distrato)),
)].sort();

const archivedRows = cancellations.filter((row) => v2Cancel.parseFlexibleDate(row.archived_at));
const archivedButWouldCancelIfNotArchived = archivedRows.filter((row) => {
  const clone = { ...row, archived_at: null };
  return v2Cancel.getAnalyticalCancellation(clone).isCancelled;
});

const multiByClient = new Map();
for (const row of cancellations) {
  const id = String(row.client_id || "");
  if (!id) continue;
  if (!multiByClient.has(id)) multiByClient.set(id, []);
  multiByClient.get(id).push(row);
}
const clientsWithMultipleCancels = [...multiByClient.entries()].filter(([, rows]) => rows.length > 1);

function latestStamp(values) {
  let max = null;
  for (const value of values) {
    if (!value) continue;
    const t = Date.parse(value);
    if (!Number.isFinite(t)) continue;
    if (max == null || t > max) max = t;
  }
  return max;
}

function leftActiveCandidate(rec, rows, days) {
  if (rec.status_analitico === "Ativo") return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const stamps = [
    rec.cancellation_date,
    rec.data_churn,
    ...rows.filter((row) => !v2Cancel.parseFlexibleDate(row.archived_at)).flatMap((row) => [
      row.churn_efetivado_at,
      row.distrato_assinado_at,
    ]),
  ];
  const stamp = latestStamp(stamps);
  return stamp != null && stamp >= cutoff;
}

const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const recentlyEffectivated = [...v2.records.values()].filter((rec) => {
  if (rec.status_analitico === "Ativo") return false;
  if (rec.status_bruto_normalizado !== "Ativo") return false;
  const t = rec.cancellation_date ? Date.parse(rec.cancellation_date) : NaN;
  const churnT = rec.data_churn ? Date.parse(rec.data_churn) : NaN;
  const stamp = Number.isFinite(t) ? t : churnT;
  return Number.isFinite(stamp) && stamp >= recentCutoff;
});

function packLeft(rec, days) {
  const rows = rowsForClient(cancellations, rec.client_id);
  if (!leftActiveCandidate(rec, rows, days)) return null;
  const stamps = [
    rec.cancellation_date,
    rec.data_churn,
    ...rows.filter((row) => !v2Cancel.parseFlexibleDate(row.archived_at)).flatMap((row) => [
      row.churn_efetivado_at,
      row.distrato_assinado_at,
    ]),
  ];
  return {
    client_id: rec.client_id,
    codigo: rec.codigo,
    nome: rec.nome,
    programa: rec.programa,
    status_bruto: rec.status_bruto,
    status_bruto_normalizado: rec.status_bruto_normalizado,
    status_analitico: rec.status_analitico,
    source: rec.cancellation_source,
    data_churn: rec.data_churn,
    cancellation_date: rec.cancellation_date,
    latest_related_stamp: iso(latestStamp(stamps)),
    cancellation_rows: describeCancelRows(rows, v2Cancel),
  };
}

const leftActive7d = [...v2.records.values()].map((rec) => packLeft(rec, 7)).filter(Boolean);
const leftActive3d = [...v2.records.values()].map((rec) => packLeft(rec, 3)).filter(Boolean);
const leftActive1d = [...v2.records.values()].map((rec) => packLeft(rec, 1)).filter(Boolean);

const rawAtivo = [...v2.records.values()].filter((rec) => rec.status_bruto_normalizado === "Ativo");
const rawAtivoNotAnalytical = rawAtivo.filter((rec) => rec.status_analitico !== "Ativo");
const analyticalAtivoRawNot = [...v2.records.values()].filter(
  (rec) => rec.status_analitico === "Ativo" && rec.status_bruto_normalizado !== "Ativo",
);

let recentlyUpdatedClients = [];
try {
  const withUpdated = await fetchAllRows({
    table: "clients",
    select: "id,codigo,name,status,data_churn,programa,updated_at",
  });
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  recentlyUpdatedClients = withUpdated
    .filter((row) => {
      const rec = v2.records.get(String(row.id));
      if (!rec || rec.status_analitico === "Ativo") return false;
      const t = Date.parse(row.updated_at);
      return Number.isFinite(t) && t >= cutoff24h;
    })
    .map((row) => {
      const rec = v2.records.get(String(row.id));
      return {
        client_id: String(row.id),
        codigo: row.codigo,
        nome: row.name,
        programa: row.programa,
        status_bruto: row.status,
        status_analitico: rec?.status_analitico,
        data_churn: row.data_churn,
        updated_at: row.updated_at,
        source: rec?.cancellation_source,
      };
    });
} catch (error) {
  recentlyUpdatedClients = [{ error: error instanceof Error ? error.message : String(error) }];
}

const report = {
  snapshot: {
    generatedAt: new Date().toISOString(),
    projectRef,
    clientSelectUsed,
    clientsFetched: clients.length,
    cancellationsFetched: cancellations.length,
    kernelsIdenticalOnThisSnapshot: kernelsIdentical,
  },
  exclusoes: {
    v1: {
      antes: v1.beforeExclusions,
      removidos: v1.removedCount,
      ids: v1.removed,
      depois: v1.afterExclusions,
    },
    v2: {
      antes: v2.beforeExclusions,
      removidos: v2.removedCount,
      ids: v2.removed,
      depois: v2.afterExclusions,
    },
    mesmaLista: JSON.stringify(v1.removed.map((r) => r.client_id).sort())
      === JSON.stringify(v2.removed.map((r) => r.client_id).sort()),
    emailNoSelectProducao: !clientSelectUsed.includes("email"),
  },
  contagem: {
    v1_ativos: v1.activeCount,
    v2_ativos: v2.activeCount,
    diferenca: v1.activeCount - v2.activeCount,
    print_anterior: { v1: 1781, v2: 1777, diferenca: 4 },
  },
  ids: {
    somente_v1: onlyV1,
    somente_v2: onlyV2,
    somente_v1_count: onlyV1.length,
    somente_v2_count: onlyV2.length,
  },
  divergentes: [...onlyV1, ...onlyV2].map((id) => explainClient(id, v1, v2, cancellations, clientsById)),
  archived_at: {
    rows_arquivadas: archivedRows.length,
    arquivadas_que_efetivariam_se_nao_arquivadas: archivedButWouldCancelIfNotArchived.length,
  },
  multiplas_cancellations: {
    clientes_com_mais_de_um_registro: clientsWithMultipleCancels.length,
    v1_multiples_no_kernel: v1.multiples.length,
    v2_multiples_no_kernel: v2.multiples.length,
  },
  distrato_valores_distintos: distratoValues.slice(0, 40),
  cancelamento_recente_status_bruto_ativo: recentlyEffectivated.map((rec) => ({
    client_id: rec.client_id,
    codigo: rec.codigo,
    nome: rec.nome,
    status_bruto: rec.status_bruto,
    status_analitico: rec.status_analitico,
    source: rec.cancellation_source,
    cancellation_date: rec.cancellation_date,
    data_churn: rec.data_churn,
  })),
  status_bruto_vs_analitico: {
    bruto_normalizado_ativo: rawAtivo.length,
    analitico_ativo: v2.activeCount,
    bruto_ativo_mas_analitico_nao: rawAtivoNotAnalytical.map((rec) => ({
      client_id: rec.client_id,
      codigo: rec.codigo,
      nome: rec.nome,
      status_bruto: rec.status_bruto,
      status_analitico: rec.status_analitico,
      source: rec.cancellation_source,
      data_churn: rec.data_churn,
    })),
    analitico_ativo_mas_bruto_nao: analyticalAtivoRawNot.length,
  },
  clients_updated_last_24h_nao_ativos: recentlyUpdatedClients,
  saida_recente_de_ativo: {
    nota: "Clientes que HOJE não são analiticamente ativos, com evidência de cancelamento recente. Candidatos a explicar 1781→1777 se a V1 foi medida antes.",
    last_24h: leftActive1d,
    last_3d_count: leftActive3d.length,
    last_7d_count: leftActive7d.length,
  },
};

console.log(JSON.stringify(report, (_, value) => jsonSafe(value), 2));
