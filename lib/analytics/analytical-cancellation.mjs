/**
 * Regra analítica oficial de cancelamento (portal inteiro).
 *
 * Cancelado efetivado = união distinta de client_id com pelo menos uma de:
 *   A) public.cancellations (não arquivado):
 *      - churn_efetivado_at preenchido; OU
 *      - distrato_assinado_at preenchido; OU
 *      - distrato = 'Assinado' (texto)
 *   B) public.clients.data_churn preenchida
 *
 * Data analítica (prioridade):
 *   1. churn_efetivado_at
 *   2. distrato_assinado_at
 *   3. clients.data_churn
 *   4. distrato texto Assinado sem data → cancelado com date null (hasConfirmedDate=false)
 *
 * NÃO usam data/status de efetivação:
 *   data_pedido, intencao_registrada_at
 */

export const ANALYTICAL_CANCEL_SELECT =
  "id,client_id,churn_efetivado_at,distrato_assinado_at,distrato,data_pedido,intencao_registrada_at,archived_at,updated_at,created_at";

export const ANALYTICAL_CANCEL_FIELDS = [
  { table: "cancellations", column: "churn_efetivado_at", role: "cancellationDatePriority1" },
  { table: "cancellations", column: "distrato_assinado_at", role: "cancellationDatePriority2" },
  { table: "cancellations", column: "distrato", role: "cancellationTextSigned" },
  { table: "clients", column: "data_churn", role: "cancellationDatePriority3" },
  { table: "cancellations", column: "archived_at", role: "cancellationSoftDelete" },
  { table: "cancellations", column: "data_pedido", role: "operationalOnly" },
  { table: "cancellations", column: "intencao_registrada_at", role: "operationalOnly" },
];

function blankToNull(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return value;
}

/** Aceita Date, ISO (YYYY-MM-DD), timestamp e DD/MM/YYYY (padrão BR). Não assume MM/DD. */
export function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s|$)/);
  if (br) {
    let y = Number(br[3]);
    if (y < 100) y += 2000;
    const day = Number(br[1]);
    const month = Number(br[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(y, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function foldToken(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Distrato textual assinado — match exato após normalização.
 * NÃO usar includes("assinado"): "Não assinado" / "nao assinado" também contém a substring.
 */
export function isDistratoTextSigned(raw) {
  const t = foldToken(raw);
  if (!t) return false;
  if (/\bnao\b/.test(t) || t.includes("pendente") || t.includes("aguardando")) return false;
  return t === "assinado";
}

export function normalizeClientStatus(rawStatus) {
  const token = foldToken(rawStatus);
  if (!token || token === "null" || token === "undefined" || token === "vazio") {
    return "Não informado";
  }
  if (["ativo", "active", "ativa"].includes(token)) return "Ativo";
  if (
    [
      "churn",
      "cancelado",
      "cancelada",
      "canceled",
      "cancelled",
      "encerrado",
      "encerrada",
      "inativo",
      "inativa",
      "inactive",
    ].includes(token)
    || token.includes("cancel")
    || token.includes("churn")
    || token.includes("encerr")
  ) {
    return "Cancelado";
  }
  if (
    ["congelado", "congelada", "freeze", "frozen", "pausado", "pausada"].includes(token)
    || token.includes("congel")
    || token.includes("pausad")
  ) {
    return "Congelado";
  }
  return "Não informado";
}

/** Rank de fonte (maior = preferida na consolidação). */
export const SOURCE_RANK = {
  churn_efetivado_at: 4,
  distrato_assinado_at: 3,
  "clients.data_churn": 2,
  distrato_assinado_text: 1,
};

const emptyOperational = (cancellation) => ({
  dataPedido: parseFlexibleDate(cancellation?.data_pedido),
  intencaoRegistradaAt: parseFlexibleDate(cancellation?.intencao_registrada_at),
});

/**
 * Avalia um registro de public.cancellations (sem clients.data_churn).
 * @returns {{
 *  isCancelled: boolean,
 *  cancellationDate: Date|null,
 *  source: string|null,
 *  hasConfirmedDate: boolean,
 *  stage: string|null,
 *  operational: object,
 *  flags: object
 * }}
 */
export function getAnalyticalCancellation(cancellation) {
  if (!cancellation || parseFlexibleDate(cancellation.archived_at)) {
    return {
      isCancelled: false,
      cancellationDate: null,
      source: null,
      hasConfirmedDate: false,
      stage: null,
      operational: emptyOperational(cancellation),
      flags: {
        hasChurnEfetivado: false,
        hasDistratoAssinadoAt: false,
        hasDistratoTextSigned: false,
        hasClientDataChurn: false,
      },
    };
  }

  const churnDate = parseFlexibleDate(cancellation.churn_efetivado_at);
  const signedDate = parseFlexibleDate(cancellation.distrato_assinado_at);
  const distratoTextSigned = isDistratoTextSigned(cancellation.distrato);
  const operational = emptyOperational(cancellation);
  const flags = {
    hasChurnEfetivado: Boolean(churnDate),
    hasDistratoAssinadoAt: Boolean(signedDate),
    hasDistratoTextSigned: distratoTextSigned,
    hasClientDataChurn: false,
  };

  if (churnDate) {
    return {
      isCancelled: true,
      cancellationDate: churnDate,
      source: "churn_efetivado_at",
      hasConfirmedDate: true,
      stage: "Churn efetivado",
      operational,
      flags,
      rawChurn: cancellation.churn_efetivado_at,
      rawDistrato: cancellation.distrato_assinado_at,
    };
  }

  if (signedDate) {
    return {
      isCancelled: true,
      cancellationDate: signedDate,
      source: "distrato_assinado_at",
      hasConfirmedDate: true,
      stage: "Distrato assinado",
      operational,
      flags,
      rawChurn: cancellation.churn_efetivado_at,
      rawDistrato: cancellation.distrato_assinado_at,
    };
  }

  if (distratoTextSigned) {
    return {
      isCancelled: true,
      cancellationDate: null,
      source: "distrato_assinado_text",
      hasConfirmedDate: false,
      stage: "Distrato assinado (texto)",
      operational,
      flags,
      rawChurn: cancellation.churn_efetivado_at,
      rawDistrato: cancellation.distrato_assinado_at,
    };
  }

  return {
    isCancelled: false,
    cancellationDate: null,
    source: null,
    hasConfirmedDate: false,
    stage: null,
    operational,
    flags,
  };
}

/**
 * Avalia clients.data_churn como fonte de efetivação.
 */
export function getClientDataChurnCancellation(client) {
  const date = parseFlexibleDate(client?.data_churn);
  if (!date) {
    return {
      isCancelled: false,
      cancellationDate: null,
      source: null,
      hasConfirmedDate: false,
      stage: null,
      flags: { hasClientDataChurn: false },
    };
  }
  return {
    isCancelled: true,
    cancellationDate: date,
    source: "clients.data_churn",
    hasConfirmedDate: true,
    stage: "Data churn (clients)",
    flags: { hasClientDataChurn: true },
  };
}

/**
 * Consolida cancellations row + client (data_churn) em um único resultado.
 * Data: churn > distrato_at > data_churn > (texto Assinado sem data).
 */
export function resolveConsolidatedCancellation(cancellation, client) {
  const fromCancel = getAnalyticalCancellation(cancellation);
  const fromClient = getClientDataChurnCancellation(client);

  if (!fromCancel.isCancelled && !fromClient.isCancelled) {
    return {
      isCancelled: false,
      cancellationDate: null,
      source: null,
      hasConfirmedDate: false,
      stage: null,
      operational: fromCancel.operational,
      flags: {
        hasChurnEfetivado: false,
        hasDistratoAssinadoAt: false,
        hasDistratoTextSigned: false,
        hasClientDataChurn: false,
      },
      sourcesMatched: [],
    };
  }

  const sourcesMatched = [];
  if (fromCancel.flags?.hasChurnEfetivado) sourcesMatched.push("churn_efetivado_at");
  if (fromCancel.flags?.hasDistratoAssinadoAt) sourcesMatched.push("distrato_assinado_at");
  if (fromCancel.flags?.hasDistratoTextSigned) sourcesMatched.push("distrato_assinado_text");
  if (fromClient.isCancelled) sourcesMatched.push("clients.data_churn");

  // Escolher data pela prioridade fixa (não pelo rank de “melhor linha”)
  let cancellationDate = null;
  let source = null;
  let hasConfirmedDate = false;
  let stage = null;

  const churnDate = parseFlexibleDate(cancellation?.churn_efetivado_at);
  const signedDate = parseFlexibleDate(cancellation?.distrato_assinado_at);
  const dataChurn = fromClient.cancellationDate;

  if (churnDate) {
    cancellationDate = churnDate;
    source = "churn_efetivado_at";
    hasConfirmedDate = true;
    stage = "Churn efetivado";
  } else if (signedDate) {
    cancellationDate = signedDate;
    source = "distrato_assinado_at";
    hasConfirmedDate = true;
    stage = "Distrato assinado";
  } else if (dataChurn) {
    cancellationDate = dataChurn;
    source = "clients.data_churn";
    hasConfirmedDate = true;
    stage = "Data churn (clients)";
  } else if (fromCancel.isCancelled && fromCancel.source === "distrato_assinado_text") {
    cancellationDate = null;
    source = "distrato_assinado_text";
    hasConfirmedDate = false;
    stage = "Distrato assinado (texto)";
  } else if (fromCancel.isCancelled) {
    cancellationDate = fromCancel.cancellationDate;
    source = fromCancel.source;
    hasConfirmedDate = fromCancel.hasConfirmedDate;
    stage = fromCancel.stage;
  } else {
    cancellationDate = fromClient.cancellationDate;
    source = fromClient.source;
    hasConfirmedDate = fromClient.hasConfirmedDate;
    stage = fromClient.stage;
  }

  return {
    isCancelled: true,
    cancellationDate,
    source,
    hasConfirmedDate,
    stage,
    operational: fromCancel.operational,
    flags: {
      hasChurnEfetivado: Boolean(churnDate),
      hasDistratoAssinadoAt: Boolean(signedDate),
      hasDistratoTextSigned: Boolean(fromCancel.flags?.hasDistratoTextSigned),
      hasClientDataChurn: Boolean(fromClient.isCancelled),
    },
    sourcesMatched,
  };
}

/**
 * Uma linha analítica por client_id.
 * União distinta: cancellations (regra A) ∪ clients.data_churn (regra B).
 *
 * @param {Array} cancellations
 * @param {Array} [clients] — opcional; se omitido, só considera cancellations
 */
export function buildAnalyticalCancellationMap(cancellations, clients = []) {
  const map = new Map();
  const activeProcessCounts = new Map();
  const orphanClientIds = [];
  const now = startOfDay(new Date());
  let formatWarnings = 0;
  let rowsWithoutClientId = 0;
  let rowsWithInvalidChurn = 0;
  let rowsWithInvalidDistrato = 0;

  const audit = {
    onlyChurnEfetivadoAt: 0,
    onlyDistratoAssinadoAt: 0,
    onlyDistratoTextSigned: 0,
    onlyClientDataChurn: 0,
    multipleSources: 0,
    effectiveWithoutConfirmedDate: 0,
    totalDistinct: 0,
    cancellationsConfirmed: 0,
    clientsDataChurn: 0,
    overlapCancelAndDataChurn: 0,
    dateDivergence: {
      sameDay: 0,
      upTo1Day: 0,
      over1Day: 0,
      maxDiffDays: 0,
      clientsAffected: 0,
    },
  };

  const clientsById = new Map();
  for (const client of clients || []) {
    const id = blankToNull(client?.id ?? client?.client_id);
    if (!id) continue;
    clientsById.set(String(id), client);
  }

  /** Acúmulo por cliente a partir de cancellations. */
  const cancelAcc = new Map();

  for (const row of cancellations || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) {
      rowsWithoutClientId += 1;
      orphanClientIds.push(row.id || null);
      continue;
    }
    const clientKey = String(clientId);
    if (parseFlexibleDate(row.archived_at)) continue;

    const rawChurn = blankToNull(row.churn_efetivado_at);
    const rawDistratoAt = blankToNull(row.distrato_assinado_at);
    if (rawChurn && !parseFlexibleDate(rawChurn)) rowsWithInvalidChurn += 1;
    if (rawDistratoAt && !parseFlexibleDate(rawDistratoAt)) rowsWithInvalidDistrato += 1;

    const fromCancel = getAnalyticalCancellation(row);
    if (!fromCancel.isCancelled) continue;

    activeProcessCounts.set(clientKey, (activeProcessCounts.get(clientKey) || 0) + 1);

    const churnDate = parseFlexibleDate(row.churn_efetivado_at);
    const signedDate = parseFlexibleDate(row.distrato_assinado_at);
    const textSigned = isDistratoTextSigned(row.distrato);
    const updated =
      parseFlexibleDate(row.updated_at)
      || parseFlexibleDate(row.created_at)
      || fromCancel.cancellationDate
      || new Date(0);

    const prev = cancelAcc.get(clientKey) || {
      churnDate: null,
      signedDate: null,
      textSigned: false,
      row: null,
      updated: new Date(0),
      rank: 0,
    };
    const next = {
      churnDate: churnDate && (!prev.churnDate || churnDate > prev.churnDate) ? churnDate : prev.churnDate,
      signedDate: signedDate && (!prev.signedDate || signedDate > prev.signedDate)
        ? signedDate
        : prev.signedDate,
      textSigned: prev.textSigned || textSigned,
      row: prev.row,
      updated: updated > prev.updated ? updated : prev.updated,
      rank: Math.max(prev.rank, SOURCE_RANK[fromCancel.source] || 0),
    };
    // Mantém a row com maior rank / data mais recente para motivo etc.
    if (!prev.row || (SOURCE_RANK[fromCancel.source] || 0) > prev.rank || updated > prev.updated) {
      next.row = row;
    } else {
      next.row = prev.row;
    }
    cancelAcc.set(clientKey, next);
  }

  const cancelConfirmedIds = new Set(cancelAcc.keys());
  const dataChurnIds = new Set();
  for (const [id, client] of clientsById.entries()) {
    if (getClientDataChurnCancellation(client).isCancelled) dataChurnIds.add(id);
  }

  const allIds = new Set([...cancelConfirmedIds, ...dataChurnIds]);

  for (const clientKey of allIds) {
    const acc = cancelAcc.get(clientKey) || null;
    const client = clientsById.get(clientKey) || null;
    const syntheticCancel = {
      ...(acc?.row || {}),
      client_id: clientKey,
      churn_efetivado_at: acc?.churnDate || null,
      distrato_assinado_at: acc?.signedDate || null,
      distrato: acc?.textSigned ? (acc?.row?.distrato || "Assinado") : (acc?.row?.distrato || null),
      archived_at: null,
      data_pedido: acc?.row?.data_pedido || null,
      intencao_registrada_at: acc?.row?.intencao_registrada_at || null,
    };
    const consolidated = resolveConsolidatedCancellation(
      acc ? syntheticCancel : null,
      client,
    );
    if (!consolidated.isCancelled) continue;

    const warnings = [];
    if (consolidated.cancellationDate && startOfDay(consolidated.cancellationDate) > now) {
      warnings.push("Data de cancelamento futura");
    }
    if (!consolidated.hasConfirmedDate) {
      warnings.push("Efetivado sem data confirmada");
    }

    map.set(clientKey, {
      date: consolidated.cancellationDate,
      stage: consolidated.stage,
      rank: SOURCE_RANK[consolidated.source] || 0,
      updated: acc?.updated || consolidated.cancellationDate || new Date(0),
      warnings,
      dateSource: consolidated.source,
      source: consolidated.source,
      isCancelled: true,
      hasConfirmedDate: consolidated.hasConfirmedDate,
      hasChurnEfetivado: consolidated.flags.hasChurnEfetivado,
      hasDistrato: consolidated.flags.hasDistratoAssinadoAt,
      hasDistratoTextSigned: consolidated.flags.hasDistratoTextSigned,
      hasClientDataChurn: consolidated.flags.hasClientDataChurn,
      sourcesMatched: consolidated.sourcesMatched,
      operationalPedido: consolidated.operational?.dataPedido || null,
      operationalIntencao: consolidated.operational?.intencaoRegistradaAt || null,
      motivo: blankToNull(acc?.row?.motivo),
      motivoCategoria: blankToNull(acc?.row?.motivo_categoria),
      cancellationRowId: blankToNull(acc?.row?.id),
    });
  }

  for (const entry of map.values()) {
    const flags = [
      entry.hasChurnEfetivado,
      entry.hasDistrato,
      entry.hasDistratoTextSigned,
      entry.hasClientDataChurn,
    ].filter(Boolean).length;
    if (flags > 1) audit.multipleSources += 1;
    else if (entry.hasChurnEfetivado) audit.onlyChurnEfetivadoAt += 1;
    else if (entry.hasDistrato) audit.onlyDistratoAssinadoAt += 1;
    else if (entry.hasDistratoTextSigned) audit.onlyDistratoTextSigned += 1;
    else if (entry.hasClientDataChurn) audit.onlyClientDataChurn += 1;
    if (!entry.hasConfirmedDate || !entry.date) audit.effectiveWithoutConfirmedDate += 1;
  }

  for (const clientKey of allIds) {
    const acc = cancelAcc.get(clientKey) || null;
    const client = clientsById.get(clientKey) || null;
    const divergence = analyzeCancellationDateDivergence(
      {
        churn_efetivado_at: acc?.churnDate || null,
        distrato_assinado_at: acc?.signedDate || null,
      },
      client,
    );
    if (divergence.dates.length >= 2 && divergence.hasDivergence) {
      audit.dateDivergence.clientsAffected += 1;
      audit.dateDivergence.maxDiffDays = Math.max(
        audit.dateDivergence.maxDiffDays,
        divergence.maxDiffDays,
      );
      if (divergence.bucket === "up_to_1_day") audit.dateDivergence.upTo1Day += 1;
      else if (divergence.bucket === "over_1_day") audit.dateDivergence.over1Day += 1;
    } else if (divergence.dates.length >= 2 && divergence.bucket === "same_day") {
      audit.dateDivergence.sameDay += 1;
    }
  }

  audit.totalDistinct = map.size;
  audit.cancellationsConfirmed = cancelConfirmedIds.size;
  audit.clientsDataChurn = dataChurnIds.size;
  for (const id of cancelConfirmedIds) {
    if (dataChurnIds.has(id)) audit.overlapCancelAndDataChurn += 1;
  }

  const multiples = new Set(
    [...activeProcessCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
  );

  return {
    map,
    multiples,
    orphanClientIds,
    activeProcessCounts,
    formatWarnings,
    rowsWithoutClientId,
    rowsWithInvalidChurn,
    rowsWithInvalidDistrato,
    audit,
  };
}

/**
 * Status analítico (portal inteiro).
 *
 * - Ativo / Congelado: bruto correspondente e SEM cancelamento efetivado.
 * - Cancelado: efetivado COM data (churn / distrato_at / data_churn).
 * - Cancelado efetivado sem data: distrato='Assinado' sem nenhuma data.
 * - Marcado como cancelado sem confirmação: bruto Cancelado/Churn SEM evidência.
 * - Não informado: bruto vazio/desconhecido SEM evidência de cancelamento.
 *
 * Alias legado: "Cancelado sem data confirmada" ≡ marcado sem confirmação.
 */
export const ANALYTICAL_STATUS = {
  ACTIVE: "Ativo",
  FROZEN: "Congelado",
  CANCELLED_CONFIRMED: "Cancelado",
  CANCELLED_EFFECTIVE_NO_DATE: "Cancelado efetivado sem data",
  CANCELLED_MARKED_NO_EVIDENCE: "Marcado como cancelado sem confirmação",
  /** @deprecated use CANCELLED_MARKED_NO_EVIDENCE — mantido para compat de import */
  CANCELLED_NO_DATE: "Marcado como cancelado sem confirmação",
  UNKNOWN: "Não informado",
};

const LEGACY_MARKED_NO_EVIDENCE = "Cancelado sem data confirmada";

/** Rótulo de exibição (gráficos/cards). */
export function analyticalStatusDisplayLabel(status) {
  if (status === ANALYTICAL_STATUS.CANCELLED_CONFIRMED || status === "Cancelado confirmado") {
    return "Cancelado confirmado";
  }
  if (status === LEGACY_MARKED_NO_EVIDENCE) {
    return ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE;
  }
  return status || ANALYTICAL_STATUS.UNKNOWN;
}

/** Cancelamento efetivado (com ou sem data confirmada). */
export function isEffectiveCancelledStatus(status) {
  return (
    status === ANALYTICAL_STATUS.CANCELLED_CONFIRMED
    || status === "Cancelado confirmado"
    || status === ANALYTICAL_STATUS.CANCELLED_EFFECTIVE_NO_DATE
  );
}

export function isConfirmedCancelledStatus(status) {
  return status === ANALYTICAL_STATUS.CANCELLED_CONFIRMED || status === "Cancelado confirmado";
}

export function isEffectiveCancelledWithoutDateStatus(status) {
  return status === ANALYTICAL_STATUS.CANCELLED_EFFECTIVE_NO_DATE;
}

export function isMarkedCancelledNoEvidenceStatus(status) {
  return (
    status === ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE
    || status === LEGACY_MARKED_NO_EVIDENCE
    || status === ANALYTICAL_STATUS.CANCELLED_NO_DATE
  );
}

/** @deprecated alias — prefer isMarkedCancelledNoEvidenceStatus */
export function isCancelledWithoutConfirmedDateStatus(status) {
  return isMarkedCancelledNoEvidenceStatus(status);
}

export function isNonActivePortfolioStatus(status) {
  return (
    status === ANALYTICAL_STATUS.FROZEN
    || isMarkedCancelledNoEvidenceStatus(status)
    || status === ANALYTICAL_STATUS.CANCELLED_EFFECTIVE_NO_DATE
  );
}

/**
 * Classificação completa a partir de cliente + info do mapa de cancelamento.
 * @returns {{
 *  analyticalStatus: string,
 *  isCancelled: boolean,
 *  cancellationDate: Date|null,
 *  cancellationSource: string|null,
 *  hasConfirmedDate: boolean,
 *  category: string
 * }}
 */
export function classifyClientAnalyticalStatus(rawStatus, cancelInfo) {
  const analyticalStatus = resolveAnalyticalStatusFromMaps(rawStatus, cancelInfo);
  const isCancelled = isEffectiveCancelledStatus(analyticalStatus);
  return {
    analyticalStatus,
    isCancelled,
    cancellationDate: cancelInfo?.date || null,
    cancellationSource: cancelInfo?.source || cancelInfo?.dateSource || null,
    hasConfirmedDate: Boolean(cancelInfo?.hasConfirmedDate && cancelInfo?.date),
    category: analyticalStatus,
  };
}

/**
 * @param {string} rawStatus
 * @param {Date|null|object} cancellationDateOrInfo — Date legado OU objeto cancelInfo do mapa
 */
export function resolveAnalyticalStatus(rawStatus, cancellationDateOrInfo) {
  if (
    cancellationDateOrInfo
    && typeof cancellationDateOrInfo === "object"
    && !(cancellationDateOrInfo instanceof Date)
    && (
      cancellationDateOrInfo.isCancelled === true
      || cancellationDateOrInfo.hasConfirmedDate != null
      || cancellationDateOrInfo.source
      || cancellationDateOrInfo.dateSource
    )
  ) {
    return resolveAnalyticalStatusFromMaps(rawStatus, cancellationDateOrInfo);
  }

  let isCancelled = false;
  if (cancellationDateOrInfo instanceof Date) {
    isCancelled = true;
  } else if (cancellationDateOrInfo && typeof cancellationDateOrInfo === "object") {
    isCancelled = cancellationDateOrInfo.isCancelled === true
      || Boolean(cancellationDateOrInfo.date);
  } else if (cancellationDateOrInfo) {
    isCancelled = true;
  }
  if (isCancelled) return ANALYTICAL_STATUS.CANCELLED_CONFIRMED;
  const normalized = normalizeClientStatus(rawStatus);
  if (normalized === "Cancelado") return ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE;
  return normalized;
}

export function resolveAnalyticalStatusFromMaps(rawStatus, cancelInfo) {
  if (cancelInfo?.isCancelled) {
    if (cancelInfo.hasConfirmedDate && cancelInfo.date) {
      return ANALYTICAL_STATUS.CANCELLED_CONFIRMED;
    }
    return ANALYTICAL_STATUS.CANCELLED_EFFECTIVE_NO_DATE;
  }
  const normalized = normalizeClientStatus(rawStatus);
  if (normalized === "Cancelado") return ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE;
  return normalized;
}

/**
 * Match de filtro de status (keys do portal) contra analyticalStatus.
 * cancelled = efetivados (com ou sem data).
 * cancelled_no_date / marked_no_evidence = marcado sem confirmação.
 * cancelled_effective_no_date = efetivado Assinado sem data.
 */
export function matchesAnalyticalStatusFilter(analyticalStatus, filterKeyOrLabel) {
  if (!filterKeyOrLabel || filterKeyOrLabel === "all") return true;
  const st = String(analyticalStatus || "");
  const key = String(filterKeyOrLabel).toLowerCase().trim().replace(/\s+/g, "_");

  if (filterKeyOrLabel === "Ativo" || key === "active" || key === "ativo") return st === "Ativo";
  if (filterKeyOrLabel === "Congelado" || key === "frozen" || key === "congelado") return st === "Congelado";
  if (
    filterKeyOrLabel === "Cancelado"
    || filterKeyOrLabel === "Cancelado confirmado"
    || key === "cancelled"
    || key === "cancelado"
    || key === "cancelled_confirmed"
    || key === "cancelados_efetivados"
  ) {
    return isEffectiveCancelledStatus(st);
  }
  if (
    key === "cancelled_with_date"
    || key === "cancelled_confirmed_only"
  ) {
    return isConfirmedCancelledStatus(st);
  }
  if (
    key === "cancelled_effective_no_date"
    || key === "cancelado_efetivado_sem_data"
  ) {
    return isEffectiveCancelledWithoutDateStatus(st);
  }
  if (
    key === "cancelled_no_date"
    || key === "cancelled_without_date"
    || key === "marked_no_evidence"
    || key === "marcados_sem_confirmacao"
    || filterKeyOrLabel === LEGACY_MARKED_NO_EVIDENCE
    || filterKeyOrLabel === ANALYTICAL_STATUS.CANCELLED_MARKED_NO_EVIDENCE
  ) {
    return isMarkedCancelledNoEvidenceStatus(st);
  }
  if (key === "unknown" || key === "nao_informado" || key === "não_informado" || filterKeyOrLabel === "Não informado") {
    return st === ANALYTICAL_STATUS.UNKNOWN;
  }
  if (key === "active_or_frozen" || key === "active_and_frozen") {
    return st === "Ativo" || st === "Congelado";
  }
  if (key === "non_active") {
    return (
      st === "Congelado"
      || isMarkedCancelledNoEvidenceStatus(st)
      || isEffectiveCancelledWithoutDateStatus(st)
    );
  }
  return st === filterKeyOrLabel;
}

/**
 * Divergência entre datas de fontes do mesmo cliente.
 */
export function analyzeCancellationDateDivergence(cancellation, client) {
  const dates = [];
  const churn = parseFlexibleDate(cancellation?.churn_efetivado_at);
  const distrato = parseFlexibleDate(cancellation?.distrato_assinado_at);
  const dataChurn = parseFlexibleDate(client?.data_churn);
  if (churn) dates.push({ source: "churn_efetivado_at", date: churn });
  if (distrato) dates.push({ source: "distrato_assinado_at", date: distrato });
  if (dataChurn) dates.push({ source: "clients.data_churn", date: dataChurn });
  if (dates.length < 2) {
    return { hasDivergence: false, maxDiffDays: 0, dates, bucket: "single_or_none" };
  }
  const times = dates.map((d) => startOfDay(d.date).getTime());
  const maxDiffDays = (Math.max(...times) - Math.min(...times)) / 86400000;
  let bucket = "same_day";
  if (maxDiffDays > 1) bucket = "over_1_day";
  else if (maxDiffDays > 0) bucket = "up_to_1_day";
  return {
    hasDivergence: maxDiffDays > 0,
    maxDiffDays,
    dates,
    bucket,
  };
}

/** Alias legado — mesma implementação. */
export function buildCancellationMap(cancellations, clients) {
  return buildAnalyticalCancellationMap(cancellations, clients);
}
