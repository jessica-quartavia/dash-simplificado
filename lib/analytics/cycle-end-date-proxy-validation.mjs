/**
 * Validação operacional/estatística de clients.data_fim_ciclo como PROXY de janela de renovação.
 * Read-only — não altera regras oficiais de métricas.
 */
import { civilDateInSaoPaulo, renewalFromClient } from "./client-cycle-renewal.mjs";
import { matchesAnalyticalStatusFilter } from "./analytical-cancellation.mjs";
import { mean, median } from "./stats-tests.mjs";
function yearEndHorizonDate(refDate = new Date()) {
  const today = civilDateInSaoPaulo(refDate);
  if (!today) return { today: null, horizonEnd: null, year: null };
  const year = today.slice(0, 4);
  return { today, horizonEnd: `${year}-12-31`, year };
}

export const DATA_FIM_CICLO_CODE_EVIDENCE = {
  field: "clients.data_fim_ciclo",
  meaningFound:
    "No código V2, mapeado como fim do ciclo atual (cycleEndDate): exibido na página Renovação, usado em Dados Gerais e Cancelamento (comparar data de cancelamento vs fim de ciclo). Não há documentação de negócio que equate o campo a “data oficial de renovação”; preenchimento é operacional na BASE QV.",
  sources: [
    { file: "lib/analytics/general-data.mjs", role: "cycleEndDate no payload de Dados Gerais" },
    { file: "lib/analytics/renewal.mjs", role: "Coluna “Fim do ciclo” na página Renovação" },
    { file: "lib/analytics/cancellations.mjs", role: "Timing “Antes do fim do ciclo” vs churn" },
    { file: "docs/regras-metricas-dashboard.csv", note: "renewal_on_time indisponível (falta fim ciclo anterior + data renovação)" },
  ],
  notFound: "Nenhum job ETL no repositório que calcule data_fim_ciclo; origem = cadastro BASE QV.",
};

function coveragePct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function parseYmd(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(startYmd, endYmd) {
  const a = parseYmd(startYmd);
  const b = parseYmd(endYmd);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function durationDistribution(days) {
  const nums = days.filter((d) => d != null && Number.isFinite(d)).slice().sort((a, b) => a - b);
  if (!nums.length) {
    return { n: 0, mean: null, median: null, p25: null, p75: null, min: null, max: null };
  }
  return {
    n: nums.length,
    mean: mean(nums) != null ? Math.round(mean(nums) * 10) / 10 : null,
    median: median(nums),
    p25: quantile(nums, 0.25),
    p75: quantile(nums, 0.75),
    min: nums[0],
    max: nums[nums.length - 1],
  };
}

function countByKey(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r) || "Não informado";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

function monthKey(ymd) {
  if (!ymd || ymd.length < 7) return null;
  return ymd.slice(0, 7);
}

/**
 * Classifica evidência do proxy (A–D). Transparente; não promove a oficial.
 */
export function classifyCycleEndProxyEvidence(metrics) {
  const reasons = [];
  let score = 0;

  const cov = metrics.coverage?.bothDatesPct ?? 0;
  if (cov >= 90) {
    score += 2;
    reasons.push(`Cobertura alta de início+fim (${cov}%).`);
  } else if (cov >= 70) {
    score += 1;
    reasons.push(`Cobertura moderada de início+fim (${cov}%).`);
  } else if (cov < 50) {
    score -= 2;
    reasons.push(`Cobertura baixa de início+fim (${cov}%).`);
  }

  const med1 = metrics.durationByCycle?.["1"]?.median;
  if (med1 != null && med1 >= 330 && med1 <= 400) {
    score += 2;
    reasons.push(`Duração mediana ciclo 1 ≈ 1 ano (${med1} dias).`);
  } else if (med1 != null && med1 >= 300 && med1 <= 430) {
    score += 1;
    reasons.push(`Duração mediana ciclo 1 plausível (${med1} dias).`);
  } else if (med1 != null) {
    score -= 1;
    reasons.push(`Duração mediana ciclo 1 atípica (${med1} dias).`);
  }

  const invPct = metrics.quality?.endBeforeStartPct ?? 0;
  if (invPct > 5) {
    score -= 2;
    reasons.push(`${invPct}% com fim anterior ao início.`);
  } else if (invPct > 1) {
    score -= 1;
    reasons.push(`${invPct}% com fim anterior ao início.`);
  }

  const pastPct = metrics.quality?.pastEndOnActivePct ?? 0;
  if (pastPct > 15) {
    score -= 2;
    reasons.push(`${pastPct}% ativos com fim de ciclo no passado.`);
  } else if (pastPct > 5) {
    score -= 1;
    reasons.push(`${pastPct}% ativos com fim de ciclo no passado.`);
  }

  const cycles = ["1", "2", "3"];
  const meds = cycles.map((c) => metrics.durationByCycle?.[c]?.median).filter((v) => v != null);
  if (meds.length >= 2) {
    const spread = Math.max(...meds) - Math.min(...meds);
    if (spread <= 60) {
      score += 1;
      reasons.push("Durações medianas estáveis entre ciclos 1–3.");
    }
  }

  if ((metrics.historicalRenewal?.renewedWithBothDatesPct ?? 0) >= 80) {
    score += 1;
    reasons.push("Maioria dos já renovados (ciclo>1) com par início/fim no ciclo atual.");
  }

  reasons.push("Sem data oficial de renovação — proxy não pode ser classificado como evidência forte (A).");

  let classification = "D";
  if (score >= 5) classification = "B";
  else if (score >= 3) classification = "B";
  else if (score >= 1) classification = "C";
  else classification = "D";

  if (score >= 7 && pastPct <= 5 && invPct <= 1 && cov >= 85) classification = "B";

  const hypothesis =
    "Quando um ciclo termina, o cliente entra em momento de renovação.";
  let hypothesisVerdict = "inconclusivo";
  if (classification === "B") hypothesisVerdict = "proxy_razoavel";
  if (classification === "C") hypothesisVerdict = "proxy_fraco";
  if (classification === "D") hypothesisVerdict = "inadequado";

  return {
    classification,
    score,
    hypothesis,
    hypothesisVerdict,
    reasons,
    labels: {
      A: "forte evidência",
      B: "proxy razoável",
      C: "proxy fraco",
      D: "inadequado",
    },
  };
}

/**
 * @param {object[]} clients — wideClients ou equivalente (entryDate, cycleEndDate, analyticalStatus, …)
 */
export function validateDataFimCicloProxy(clients, options = {}) {
  const { today, horizonEnd, year } = yearEndHorizonDate(options.refDate || new Date());
  const active = (clients || []).filter((c) =>
    matchesAnalyticalStatusFilter(c.analyticalStatus, "active"),
  );

  let withStart = 0;
  let withEnd = 0;
  let withBoth = 0;
  let withNeither = 0;

  const durationByCycle = {};
  const quality = {
    endBeforeStart: 0,
    pastEndOnActive: 0,
    nullEnd: 0,
    nullStart: 0,
    absurdDuration: 0,
    farFutureEnd: 0,
  };

  const horizonWindow = [];
  const renewedCiclo2Plus = [];

  for (const c of active) {
    const start = c.entryDate || c.cycleStartDate || null;
    const end = c.cycleEndDate || null;
    const hasS = Boolean(start);
    const hasE = Boolean(end);
    if (hasS) withStart += 1;
    else quality.nullStart += 1;
    if (hasE) withEnd += 1;
    else quality.nullEnd += 1;
    if (hasS && hasE) withBoth += 1;
    else if (!hasS && !hasE) withNeither += 1;

    if (hasS && hasE) {
      const days = daysBetween(start, end);
      const cycleKey = c.currentCycle != null && c.currentCycle > 0 ? String(Math.min(c.currentCycle, 5)) : "unknown";
      const bucket = cycleKey === "5" ? "5+" : cycleKey;
      if (!durationByCycle[bucket]) durationByCycle[bucket] = [];
      if (days != null) durationByCycle[bucket].push(days);
      if (days != null && days < 0) quality.endBeforeStart += 1;
      if (days != null && (days < 30 || days > 800)) quality.absurdDuration += 1;
      if (end && today && end > `${Number(today.slice(0, 4)) + 3}-01-01`) quality.farFutureEnd += 1;
    }
    if (hasE && today && end < today) quality.pastEndOnActive += 1;

    if (hasE && today && horizonEnd && end >= today && end <= horizonEnd) {
      horizonWindow.push(c);
    }

    const renewal = renewalFromClient(c);
    if (renewal.valid && renewal.hasRenewed && (c.currentCycle || 0) >= 2) {
      renewedCiclo2Plus.push({
        hasBoth: hasS && hasE,
        durationDays: hasS && hasE ? daysBetween(start, end) : null,
        currentCycle: c.currentCycle,
      });
    }
  }

  const durationStatsByCycle = {};
  for (const [k, arr] of Object.entries(durationByCycle)) {
    durationStatsByCycle[k] = durationDistribution(arr);
  }

  const nActive = active.length;
  const coverage = {
    active: nActive,
    withStart,
    withEnd,
    withBoth,
    withNeither,
    startPct: coveragePct(withStart, nActive),
    endPct: coveragePct(withEnd, nActive),
    bothDatesPct: coveragePct(withBoth, nActive),
    neitherPct: coveragePct(withNeither, nActive),
  };

  const qualityOut = {
    ...quality,
    endBeforeStartPct: coveragePct(quality.endBeforeStart, withBoth || nActive),
    pastEndOnActivePct: coveragePct(quality.pastEndOnActive, nActive),
    absurdDurationPct: coveragePct(quality.absurdDuration, withBoth || nActive),
    farFutureEndPct: coveragePct(quality.farFutureEnd, withEnd || nActive),
  };

  const renewedN = renewedCiclo2Plus.length;
  const renewedBoth = renewedCiclo2Plus.filter((r) => r.hasBoth).length;
  const renewedDurations = renewedCiclo2Plus.map((r) => r.durationDays).filter((d) => d != null);

  const historicalRenewal = {
    renewedClientsCiclo2Plus: renewedN,
    withBothDates: renewedBoth,
    renewedWithBothDatesPct: coveragePct(renewedBoth, renewedN),
    currentCycleDurationMedian: median(renewedDurations),
    reconstructionNote:
      "Não há histórico de ciclos anteriores na BASE QV (apenas par início/fim do ciclo atual). Não é possível reconstruir fim do ciclo anterior → início pós-renovação com precisão; validamos coerência do par atual em clientes já renovados.",
    impliedRenewalStart:
      "Para ciclo ≥ 2, data_inicio_ciclo reflete o ciclo corrente (início após última renovação registrada via incremento de ciclo), não o primeiro contrato.",
  };

  const yearPrefix = year || today?.slice(0, 4);
  const monthsRemaining = [];
  for (let m = 9; m <= 12; m += 1) {
    const key = `${yearPrefix}-${String(m).padStart(2, "0")}`;
    monthsRemaining.push({
      month: key,
      label: key,
      count: horizonWindow.filter((c) => monthKey(c.cycleEndDate) === key).length,
    });
  }

  const horizon = {
    label: "Clientes com fim de ciclo até 31/12",
    notEligibleOfficial: true,
    today,
    horizonEnd,
    total: horizonWindow.length,
    byProgram: countByKey(horizonWindow, (c) => c.program),
    byEp: countByKey(horizonWindow, (c) => c.ep),
    bySegment: countByKey(horizonWindow, (c) => c.segment),
    monthly: monthsRemaining,
    byMonth: monthsRemaining,
    pharus: horizonWindow.filter((c) => String(c.program || "").toLowerCase().includes("pharus")).length,
    davos: horizonWindow.filter((c) => String(c.program || "").toLowerCase().includes("davos")).length,
  };

  const metrics = {
    coverage,
    durationByCycle: durationStatsByCycle,
    quality: qualityOut,
    historicalRenewal,
    horizon,
  };

  const evidence = classifyCycleEndProxyEvidence(metrics);

  return {
    generatedAt: new Date().toISOString(),
    fieldDocumentation: DATA_FIM_CICLO_CODE_EVIDENCE,
    today,
    horizonEnd,
    year,
    metrics,
    evidence,
    proxyLabel:
      "PROXY — data_fim_ciclo como aproximação da janela de fim de ciclo (não data oficial de renovação).",
  };
}
