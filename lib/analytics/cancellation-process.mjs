/**
 * Processo de cancelamento (etapas operacionais ≠ cancelamento efetivado).
 *
 * Intenção  = intencao_registrada_at
 * Pedido    = data_pedido
 * Efetivado = churn_efetivado_at OR distrato_assinado_at OR distrato='Assinado'
 *             OR clients.data_churn (via mapa analítico consolidado)
 *
 * data_pedido / intencao_registrada_at NÃO definem cancelamento analítico.
 */
import {
  getAnalyticalCancellation,
  isDistratoTextSigned,
  parseFlexibleDate,
} from "./analytical-cancellation.mjs";
import { categorizeCancellationReason } from "./cancellation-reason-category.mjs";

export const CANCELLATION_PROCESS_SELECT = [
  "id",
  "client_id",
  "status_id",
  "motivo",
  "motivo_categoria",
  "churn_efetivado_at",
  "distrato_assinado_at",
  "distrato",
  "data_pedido",
  "intencao_registrada_at",
  "archived_at",
  "updated_at",
  "created_at",
  "passou_retencao",
  "entered_retencao_at",
  "retencao_iniciada_at",
  "nao_retencao_at",
  "desfecho",
  "tratativa",
  "valor_pago",
  "valor_a_reembolsar",
  "responsavel_name",
  "assigned_to",
  "is_critical",
  "estagio_cliente",
  "entered_offboarding_at",
  "stage_entered_at",
].join(",");

/**
 * Entrada no processo (não é data de cancelamento efetivo):
 * coalesce(data_pedido, intencao_registrada_at, stage_entered_at).
 * stage_entered_at só entra quando pedido/intenção estão vazios.
 */
export function resolveProcessEntryDate(pedidoDate, intencaoDate, stageEnteredAt = null) {
  if (pedidoDate) return { date: pedidoDate, source: "data_pedido" };
  if (intencaoDate) return { date: intencaoDate, source: "intencao_registrada_at" };
  if (stageEnteredAt) return { date: stageEnteredAt, source: "stage_entered_at" };
  return { date: null, source: null };
}

export function resolveAnalyticalProcessSituation({
  hasEfetivado,
  hasConfirmedDate = true,
  hasOffboarding = false,
  hasRetencao = false,
  hasIntentionOrPedido = false,
  hasPedido = false,
  hasIntencao = false,
}) {
  if (hasEfetivado) {
    return hasConfirmedDate
      ? "Cancelamento efetivado com data"
      : "Cancelamento efetivado sem data";
  }
  if (hasOffboarding) return "Em offboarding";
  if (hasRetencao) return "Em retenção";
  if (hasIntentionOrPedido || hasPedido || hasIntencao) return "Intenção/pedido em andamento";
  return "Sem etapa identificada";
}

export const STAGE = {
  EFETIVADO: "Cancelamento efetivado",
  OFFBOARDING: "Offboarding",
  RETENCAO: "Retenção",
  INTENCAO_PEDIDO: "Intenção/pedido de cancelamento",
  /** @deprecated use INTENCAO_PEDIDO — mantido para compatibilidade de filtros legados */
  PEDIDO: "Pedido de cancelamento",
  /** @deprecated use INTENCAO_PEDIDO */
  INTENCAO: "Intenção de cancelamento",
  NENHUMA: "Sem etapa identificada",
};

export const STAGE_KEYS = {
  EFETIVADO: "efetivado",
  OFFBOARDING: "offboarding",
  RETENCAO: "retencao",
  INTENCAO_PEDIDO: "intencao_pedido",
  PEDIDO: "pedido",
  INTENCAO: "intencao",
  NENHUMA: "nenhuma",
};

/** Status de cancellation_statuses que contam como intenção/pedido. */
export function isIntentionPedidoStatusName(raw) {
  const t = foldToken(raw);
  if (!t) return false;
  if (t.includes("nova inten")) return true;
  if (t.includes("pedido") && t.includes("cancel")) return true;
  if (t === "intencao" || t === "pedido") return true;
  return false;
}

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

function toBool(value) {
  const raw = blankToNull(value);
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (["true", "t", "1", "sim", "yes", "y"].includes(s)) return true;
  if (["false", "f", "0", "nao", "não", "no", "n"].includes(s)) return false;
  return null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function foldToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEstagioCliente(raw) {
  const t = foldToken(raw);
  if (!t) return "Não informado";
  if (t === "ativo_recente" || t.includes("recente")) return "Ativo recente";
  if (t === "ativo_maduro" || t.includes("maduro")) return "Ativo maduro";
  if (t === "indefinido" || t.includes("indefin")) return "Indefinido";
  if (t.includes("avaliacao") || t.includes("avaliação")) return "Avaliação 7d";
  return blankToNull(raw) ? String(raw).trim() : "Não informado";
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000);
}

function validPositiveDays(start, end) {
  const d = daysBetween(start, end);
  if (d == null || d < 0) return null;
  return d;
}

function stageRank(stageKey) {
  if (stageKey === STAGE_KEYS.EFETIVADO) return 5;
  if (stageKey === STAGE_KEYS.OFFBOARDING) return 4;
  if (stageKey === STAGE_KEYS.RETENCAO) return 3;
  if (stageKey === STAGE_KEYS.INTENCAO_PEDIDO || stageKey === STAGE_KEYS.PEDIDO || stageKey === STAGE_KEYS.INTENCAO) {
    return 2;
  }
  return 0;
}

/**
 * Etapa atual exclusiva (um cliente = uma barra):
 * efetivado > offboarding > retenção > intenção/pedido > nenhuma
 */
function resolveExclusiveStage({
  hasEfetivado,
  hasOffboarding = false,
  hasRetencao = false,
  hasIntentionOrPedido = false,
  hasPedido = false,
  hasIntencao = false,
}) {
  if (hasEfetivado) return { key: STAGE_KEYS.EFETIVADO, label: STAGE.EFETIVADO };
  if (hasOffboarding) return { key: STAGE_KEYS.OFFBOARDING, label: STAGE.OFFBOARDING };
  if (hasRetencao) return { key: STAGE_KEYS.RETENCAO, label: STAGE.RETENCAO };
  if (hasIntentionOrPedido || hasPedido || hasIntencao) {
    return { key: STAGE_KEYS.INTENCAO_PEDIDO, label: STAGE.INTENCAO_PEDIDO };
  }
  return { key: STAGE_KEYS.NENHUMA, label: STAGE.NENHUMA };
}

function parseDateOrInvalid(raw, invalidBag) {
  const text = blankToNull(raw);
  if (!text) return { date: null, invalid: false };
  const date = parseFlexibleDate(text);
  if (!date) {
    invalidBag.push(String(text).slice(0, 40));
    return { date: null, invalid: true };
  }
  return { date, invalid: false };
}

/**
 * Uma linha analítica por client_id a partir de public.cancellations (+ clients.data_churn).
 * Por padrão ignora archived_at preenchido.
 */
export function buildCancellationProcessMap(cancellations, { includeArchived = false, clients = [] } = {}) {
  const map = new Map();
  const activeCounts = new Map();
  let rowsWithoutClientId = 0;
  let archivedRows = 0;
  let distratoTextSignedWithoutDate = 0;
  let invalidDateCount = 0;
  const invalidDateSamples = [];

  for (const row of cancellations || []) {
    const archivedAt = parseFlexibleDate(row.archived_at);
    if (archivedAt) {
      archivedRows += 1;
      if (!includeArchived) continue;
    }

    const clientId = blankToNull(row.client_id);
    if (!clientId) {
      rowsWithoutClientId += 1;
      continue;
    }
    const clientKey = String(clientId);

    const invalidBag = [];
    const churnParsed = parseDateOrInvalid(row.churn_efetivado_at, invalidBag);
    const distratoParsed = parseDateOrInvalid(row.distrato_assinado_at, invalidBag);
    const pedidoParsed = parseDateOrInvalid(row.data_pedido, invalidBag);
    const intencaoParsed = parseDateOrInvalid(row.intencao_registrada_at, invalidBag);
    const enteredRetencao = parseDateOrInvalid(row.entered_retencao_at, invalidBag);
    const retencaoIniciada = parseDateOrInvalid(row.retencao_iniciada_at, invalidBag);
    const naoRetencao = parseDateOrInvalid(row.nao_retencao_at, invalidBag);
    const enteredOffboarding = parseDateOrInvalid(row.entered_offboarding_at, invalidBag);
    const stageEntered = parseDateOrInvalid(row.stage_entered_at, invalidBag);

    if (invalidBag.length) {
      invalidDateCount += invalidBag.length;
      for (const s of invalidBag) {
        if (invalidDateSamples.length < 8) invalidDateSamples.push(s);
      }
    }

    const analytical = getAnalyticalCancellation({
      ...row,
      churn_efetivado_at: churnParsed.date || row.churn_efetivado_at,
      distrato_assinado_at: distratoParsed.date || row.distrato_assinado_at,
      distrato: row.distrato,
    });

    const churnDate = churnParsed.date;
    const distratoDate = distratoParsed.date;
    const pedidoDate = pedidoParsed.date;
    const intencaoDate = intencaoParsed.date;
    // Efetivado: churn/distrato dates OU distrato texto Assinado (getAnalyticalCancellation)
    const hasEfetivado = Boolean(churnDate || distratoDate || analytical.isCancelled);
    const hasPedido = Boolean(pedidoDate);
    const hasIntencao = Boolean(intencaoDate);
    const retentionStart = enteredRetencao.date || retencaoIniciada.date;
    const hasRetencao = Boolean(retentionStart) || toBool(row.passou_retencao) === true;
    const hasOffboarding = Boolean(enteredOffboarding.date);
    // hasIntentionOrPedido: datas; status de intenção/pedido é enriquecido no endpoint.
    const hasIntentionOrPedidoDates = hasPedido || hasIntencao;

    const distratoText = blankToNull(row.distrato);
    if (isDistratoTextSigned(distratoText) && !distratoDate) {
      distratoTextSignedWithoutDate += 1;
    }

    const updated =
      parseFlexibleDate(row.updated_at)
      || parseFlexibleDate(row.created_at)
      || analytical.cancellationDate
      || pedidoDate
      || intencaoDate
      || new Date(0);

    const motivo = blankToNull(row.motivo);
    const categorized = categorizeCancellationReason(motivo);
    const passouRetencao = toBool(row.passou_retencao);
    const desfechoRaw = blankToNull(row.desfecho);
    const desfechoToken = foldToken(desfechoRaw);
    const isRetido = desfechoToken === "retido" || desfechoToken.includes("retid");
    const isCritical = toBool(row.is_critical) === true;
    const tratativa = blankToNull(row.tratativa);
    const responsavel =
      blankToNull(row.responsavel_name) || blankToNull(row.assigned_to) || null;
    const valorPago = toNumber(row.valor_pago);
    const valorReembolso = toNumber(row.valor_a_reembolsar);

    const chronologicalIssues = [];
    if (intencaoDate && pedidoDate && pedidoDate < intencaoDate) {
      chronologicalIssues.push("pedido_antes_intencao");
    }
    if (pedidoDate && analytical.cancellationDate && analytical.cancellationDate < pedidoDate) {
      chronologicalIssues.push("efetivado_antes_pedido");
    }
    if (intencaoDate && analytical.cancellationDate && analytical.cancellationDate < intencaoDate) {
      chronologicalIssues.push("efetivado_antes_intencao");
    }

    const processEntry = resolveProcessEntryDate(pedidoDate, intencaoDate, stageEntered.date);
    const hasIntentionOrPedido = hasIntentionOrPedidoDates;
    const exclusive = resolveExclusiveStage({
      hasEfetivado,
      hasOffboarding,
      hasRetencao,
      hasIntentionOrPedido,
    });
    const inProcessCurrently = hasIntentionOrPedido && !hasEfetivado;
    const analyticalSituation = resolveAnalyticalProcessSituation({
      hasEfetivado,
      hasConfirmedDate: analytical.hasConfirmedDate !== false && Boolean(analytical.cancellationDate),
      hasOffboarding,
      hasRetencao,
      hasIntentionOrPedido,
    });

    const candidate = {
      clientId: clientKey,
      cancellationRowId: blankToNull(row.id),
      archivedAt: archivedAt || null,
      isArchived: Boolean(archivedAt),
      hasArchivedRecord: Boolean(archivedAt),
      statusId: blankToNull(row.status_id),
      intencaoAt: intencaoDate,
      pedidoAt: pedidoDate,
      processEntryAt: processEntry.date,
      processEntrySource: processEntry.source,
      inProcessCurrently,
      analyticalSituation,
      churnEfetivadoAt: churnDate,
      distratoAssinadoAt: distratoDate,
      analyticalCancellationAt: analytical.cancellationDate || null,
      analyticalSource: analytical.source || null,
      hasConfirmedDate: analytical.hasConfirmedDate === true,
      hasIntencao,
      hasPedido,
      hasIntentionOrPedido,
      hasEfetivado,
      hasRetencao,
      hasOffboarding,
      exclusiveStageKey: exclusive.key,
      exclusiveStage: exclusive.label,
      stageRank: stageRank(exclusive.key),
      updated,
      motivo,
      motivoCategoriaDb: blankToNull(row.motivo_categoria),
      reasonCategory: categorized.category,
      hasReason: Boolean(motivo),
      distratoText,
      distratoTextSignedWithoutDate: isDistratoTextSigned(distratoText) && !distratoDate,
      passouRetencao,
      retentionStartAt: retentionStart,
      naoRetencaoAt: naoRetencao.date,
      desfecho: desfechoRaw,
      hasDesfecho: Boolean(desfechoRaw),
      isRetido,
      tratativa,
      hasTratativa: Boolean(tratativa),
      valorPago,
      valorReembolso,
      responsavel,
      assignedTo: blankToNull(row.assigned_to),
      isCritical,
      estagioClienteRaw: blankToNull(row.estagio_cliente),
      estagioCliente: normalizeEstagioCliente(row.estagio_cliente),
      enteredOffboardingAt: enteredOffboarding.date,
      stageEnteredAt: stageEntered.date,
      chronologicalIssues,
      invalidDateFlags: {
        churn: churnParsed.invalid,
        distrato: distratoParsed.invalid,
        pedido: pedidoParsed.invalid,
        intencao: intencaoParsed.invalid,
      },
    };

    activeCounts.set(clientKey, (activeCounts.get(clientKey) || 0) + 1);

    const current = map.get(clientKey);
    if (!current) {
      map.set(clientKey, candidate);
      continue;
    }

    // Quando o universo inclui histórico arquivado, a linha não arquivada deve
    // representar o processo atual. O histórico continua marcado separadamente.
    const better = current.isArchived && !candidate.isArchived
      ? true
      : candidate.isArchived && !current.isArchived
        ? false
        : candidate.stageRank > current.stageRank
          || (candidate.stageRank === current.stageRank
            && (candidate.updated > current.updated
              || (candidate.updated.getTime() === current.updated.getTime()
                && String(candidate.cancellationRowId || "") > String(current.cancellationRowId || ""))));

    const mergeProcessFields = (primary, secondary) => {
      const hasIntencao = primary.hasIntencao || secondary.hasIntencao;
      const hasPedido = primary.hasPedido || secondary.hasPedido;
      const hasEfetivado = primary.hasEfetivado || secondary.hasEfetivado;
      const hasRetencao = primary.hasRetencao || secondary.hasRetencao
        || primary.passouRetencao === true || secondary.passouRetencao === true;
      const hasOffboarding = Boolean(
        primary.hasOffboarding || secondary.hasOffboarding
        || primary.enteredOffboardingAt || secondary.enteredOffboardingAt,
      );
      const intencaoAt = primary.intencaoAt || secondary.intencaoAt;
      const pedidoAt = primary.pedidoAt || secondary.pedidoAt;
      const stageEnteredAt = primary.stageEnteredAt || secondary.stageEnteredAt;
      const processEntry = resolveProcessEntryDate(pedidoAt, intencaoAt, stageEnteredAt);
      const hasIntentionOrPedido = hasPedido || hasIntencao
        || primary.hasIntentionOrPedido || secondary.hasIntentionOrPedido;
      const excl = resolveExclusiveStage({
        hasEfetivado,
        hasOffboarding,
        hasRetencao,
        hasIntentionOrPedido,
      });
      const hasConfirmedDate = Boolean(
        primary.hasConfirmedDate || secondary.hasConfirmedDate
        || primary.analyticalCancellationAt || secondary.analyticalCancellationAt,
      );
      return {
        ...primary,
        hasIntencao,
        hasPedido,
        hasIntentionOrPedido,
        hasEfetivado,
        hasRetencao,
        hasOffboarding,
        intencaoAt,
        pedidoAt,
        stageEnteredAt,
        processEntryAt: processEntry.date,
        processEntrySource: processEntry.source,
        inProcessCurrently: hasIntentionOrPedido && !hasEfetivado,
        analyticalSituation: resolveAnalyticalProcessSituation({
          hasEfetivado,
          hasConfirmedDate,
          hasOffboarding,
          hasRetencao,
          hasIntentionOrPedido,
        }),
        churnEfetivadoAt: primary.churnEfetivadoAt || secondary.churnEfetivadoAt,
        distratoAssinadoAt: primary.distratoAssinadoAt || secondary.distratoAssinadoAt,
        analyticalCancellationAt:
          primary.analyticalCancellationAt || secondary.analyticalCancellationAt,
        statusId: primary.statusId || secondary.statusId,
        passouRetencao:
          primary.passouRetencao === true || secondary.passouRetencao === true
            ? true
            : primary.passouRetencao ?? secondary.passouRetencao,
        retentionStartAt: primary.retentionStartAt || secondary.retentionStartAt,
        enteredOffboardingAt: primary.enteredOffboardingAt || secondary.enteredOffboardingAt,
        isCritical: primary.isCritical || secondary.isCritical,
        hasArchivedRecord: Boolean(
          primary.hasArchivedRecord || secondary.hasArchivedRecord
          || primary.isArchived || secondary.isArchived,
        ),
        exclusiveStageKey: excl.key,
        exclusiveStage: excl.label,
        stageRank: stageRank(excl.key),
        chronologicalIssues: [...new Set([
          ...(primary.chronologicalIssues || []),
          ...(secondary.chronologicalIssues || []),
        ])],
      };
    };

    if (better) {
      map.set(clientKey, mergeProcessFields(candidate, current));
    } else {
      map.set(clientKey, mergeProcessFields(current, candidate));
    }
  }

  // União com clients.data_churn (efetivação sem linha em cancellations ou reforço de data)
  for (const client of clients || []) {
    const clientKey = blankToNull(client?.id);
    if (!clientKey) continue;
    const dataChurn = parseFlexibleDate(client.data_churn);
    if (!dataChurn) continue;
    const key = String(clientKey);
    const existing = map.get(key);
    if (existing) {
      if (!existing.hasEfetivado) {
        existing.hasEfetivado = true;
        existing.analyticalCancellationAt = existing.analyticalCancellationAt || dataChurn;
        existing.analyticalSource = existing.analyticalSource || "clients.data_churn";
        existing.hasConfirmedDate = true;
        const excl = resolveExclusiveStage({
          hasEfetivado: true,
          hasOffboarding: existing.hasOffboarding,
          hasRetencao: existing.hasRetencao,
          hasIntentionOrPedido: existing.hasIntentionOrPedido || existing.hasPedido || existing.hasIntencao,
        });
        existing.exclusiveStageKey = excl.key;
        existing.exclusiveStage = excl.label;
        existing.stageRank = stageRank(excl.key);
        existing.analyticalSituation = resolveAnalyticalProcessSituation({
          hasEfetivado: true,
          hasConfirmedDate: true,
          hasOffboarding: existing.hasOffboarding,
          hasRetencao: existing.hasRetencao,
          hasIntentionOrPedido: existing.hasIntentionOrPedido || existing.hasPedido || existing.hasIntencao,
        });
        existing.inProcessCurrently = false;
      } else if (!existing.analyticalCancellationAt) {
        // Efetivado por texto Assinado sem data → data_churn preenche
        existing.analyticalCancellationAt = dataChurn;
        existing.analyticalSource = existing.analyticalSource || "clients.data_churn";
        existing.hasConfirmedDate = true;
        existing.analyticalSituation = resolveAnalyticalProcessSituation({
          hasEfetivado: true,
          hasConfirmedDate: true,
          hasOffboarding: existing.hasOffboarding,
          hasRetencao: existing.hasRetencao,
          hasIntentionOrPedido: existing.hasIntentionOrPedido,
        });
      }
      existing.hasClientDataChurn = true;
      continue;
    }
    map.set(key, {
      clientId: key,
      hasEfetivado: true,
      hasPedido: false,
      hasIntencao: false,
      hasIntentionOrPedido: false,
      hasRetencao: false,
      hasOffboarding: false,
      analyticalCancellationAt: dataChurn,
      analyticalSource: "clients.data_churn",
      hasConfirmedDate: true,
      hasClientDataChurn: true,
      exclusiveStageKey: STAGE_KEYS.EFETIVADO,
      exclusiveStage: STAGE.EFETIVADO,
      stageRank: stageRank(STAGE_KEYS.EFETIVADO),
      analyticalSituation: "Cancelamento efetivado com data",
      inProcessCurrently: false,
      intencaoAt: null,
      pedidoAt: null,
      processEntryAt: null,
      processEntrySource: null,
      motivo: null,
      motivoCategoriaDb: null,
      reasonCategory: "Não informado",
      passouRetencao: null,
      retentionStartAt: null,
      desfecho: null,
      isRetido: false,
      hasDesfecho: false,
      hasTratativa: false,
      hasArchivedRecord: false,
      isCritical: false,
      tratativa: null,
      responsavel: null,
      valorPago: null,
      valorReembolso: null,
      estagioCliente: "Não informado",
      enteredOffboardingAt: null,
      stageEnteredAt: null,
      statusId: null,
      distratoTextSignedWithoutDate: false,
      chronologicalIssues: [],
      archivedAt: null,
      updatedAt: dataChurn,
      cancellationRowId: null,
    });
  }

  const multiples = new Set(
    [...activeCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
  );

  return {
    map,
    multiples,
    rowsWithoutClientId,
    archivedRows,
    distratoTextSignedWithoutDate,
    invalidDateCount,
    invalidDateSamples,
    activeCounts,
  };
}

export function medianOf(values) {
  const sorted = values.filter((v) => v != null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { median: null, sampleSize: 0 };
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
      : sorted[mid];
  return { median, sampleSize: sorted.length };
}

export function rateOrInsufficient(numerator, denominator) {
  if (!denominator) {
    return { rate: null, label: "Dados insuficientes", numerator, denominator: 0 };
  }
  const rate = Math.round((numerator / denominator) * 1000) / 10;
  return { rate, label: `${rate}%`, numerator, denominator };
}

export { validPositiveDays, toBool, toNumber, blankToNull, foldToken, isDistratoTextSigned };
