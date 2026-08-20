/**
 * NPS oficial (0–10): índice = % Promotores − % Detratores.
 * Não chamar média da nota de “NPS”.
 */
export const NPS_MIN_RESPONSES_PER_EP = 5;
export const NPS_MIN_COVERAGE_PCT = 20;

export function classifyNpsScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  if (n >= 9) return "promoter";
  if (n >= 7) return "passive";
  return "detractor";
}

export function computeNpsBreakdown(scores) {
  const valid = [];
  for (const s of scores || []) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 10) continue;
    valid.push(n);
  }
  const total = valid.length;
  if (!total) {
    return {
      responses: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      promoterPct: null,
      passivePct: null,
      detractorPct: null,
      nps: null,
      meanScore: null,
    };
  }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let sum = 0;
  for (const n of valid) {
    sum += n;
    const cls = classifyNpsScore(n);
    if (cls === "promoter") promoters += 1;
    else if (cls === "passive") passives += 1;
    else detractors += 1;
  }
  const pct = (n) => Math.round((n / total) * 1000) / 10;
  const promoterPct = pct(promoters);
  const detractorPct = pct(detractors);
  return {
    responses: total,
    promoters,
    passives,
    detractors,
    promoterPct,
    passivePct: pct(passives),
    detractorPct,
    /** Índice NPS oficial — não é média */
    nps: Math.round((promoterPct - detractorPct) * 10) / 10,
    meanScore: Math.round((sum / total) * 10) / 10,
  };
}

/**
 * Deduplica por client_id: resposta válida mais recente.
 * Ordenação: submitted_at desc, depois created_at desc.
 * @returns {{ rows: Array, meta: object }}
 */
export function dedupeNpsResponses(rows) {
  const best = new Map();
  let rawCount = 0;
  let invalidScore = 0;
  let withoutClient = 0;
  let skippedTipo = 0;

  for (const row of rows || []) {
    rawCount += 1;
    const clientId = row?.client_id != null ? String(row.client_id) : "";
    if (!clientId) {
      withoutClient += 1;
      continue;
    }
    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      invalidScore += 1;
      continue;
    }
    const tipo = String(row.tipo_de_forms || "").toUpperCase();
    if (tipo && !tipo.startsWith("NPS")) {
      skippedTipo += 1;
      continue;
    }
    const submittedMs = row.submitted_at ? new Date(row.submitted_at).getTime() : NaN;
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
    const sortSubmitted = Number.isFinite(submittedMs) ? submittedMs : -1;
    const sortCreated = Number.isFinite(createdMs) ? createdMs : -1;
    const cur = best.get(clientId);
    const better =
      !cur
      || sortSubmitted > cur.submittedMs
      || (sortSubmitted === cur.submittedMs && sortCreated >= cur.createdMs);
    if (better) {
      best.set(clientId, {
        clientId,
        score,
        submittedAt: row.submitted_at || null,
        createdAt: row.created_at || null,
        submittedMs: sortSubmitted,
        createdMs: sortCreated,
        responseId: row.id || null,
      });
    }
  }

  const consolidated = [...best.values()];
  const discardedDuplicates = Math.max(
    0,
    rawCount - withoutClient - invalidScore - skippedTipo - consolidated.length,
  );

  return {
    rows: consolidated,
    meta: {
      rawResponses: rawCount,
      validResponses: consolidated.length + discardedDuplicates,
      respondentClients: consolidated.length,
      discardedDuplicates,
      withoutClientId: withoutClient,
      invalidScore,
      skippedNonNpsTipo: skippedTipo,
      dedupeRule: "submitted_at desc, created_at desc · 1 linha por client_id",
    },
  };
}

/** Compat: retorna só as linhas consolidadas. */
export function latestNpsByClient(rows) {
  return dedupeNpsResponses(rows).rows;
}

export function npsSampleBadge(responses, min = NPS_MIN_RESPONSES_PER_EP) {
  if (responses == null || responses <= 0) return { code: "empty", label: "Sem respostas" };
  if (responses < min) return { code: "small", label: "Amostra pequena" };
  return { code: "regular", label: "Amostra regular" };
}
