/**
 * ETAPA 1 — Baseline congelado: modelo exploratório atual, somente clientes ativos.
 * BASE QV read-only. Não altera metodologia nem treino.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mean } from "../lib/analytics/stats-tests.mjs";
import { CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import { IMS_RENEWAL_PROJECTION_VERSION } from "../lib/analytics/internal-mechanisms-renewal-projection.mjs";
import { loadMechanismsSatisfactionDataset, fetchMechanismsSatisfactionRawData } from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { buildCanonicalRenewalPopulation } from "../lib/analytics/internal-mechanisms-renewal-population.mjs";
import { matchesAnalyticalStatusFilter } from "../lib/analytics/analytical-cancellation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    parsed[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return parsed;
}

for (const [k, v] of Object.entries(parseEnvFile(resolve(root, ".env")))) {
  if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
}

function mechanismBand(n) {
  const x = Number(n) || 0;
  if (x >= 4) return "4+";
  return String(x);
}

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function round3(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 1000) / 1000;
}

function round4(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10000) / 10000;
}

function calibrationBinsReport(probs, labels) {
  const defs = [
    { label: "0–10%", lo: 0, hi: 0.1 },
    { label: "10–20%", lo: 0.1, hi: 0.2 },
    { label: "20–40%", lo: 0.2, hi: 0.4 },
    { label: "40–60%", lo: 0.4, hi: 0.6 },
    { label: "60%+", lo: 0.6, hi: 1.001 },
  ];
  return defs.map(({ label, lo, hi }) => {
    const idx = [];
    for (let i = 0; i < probs.length; i += 1) {
      const p = probs[i];
      if (p == null || labels[i] !== 0 && labels[i] !== 1) continue;
      if (p >= lo && p < hi) idx.push(i);
    }
    if (!idx.length) {
      return { bin: label, n: 0, meanPredicted: null, observedRate: null };
    }
    const ps = idx.map((i) => probs[i]);
    const ys = idx.map((i) => labels[i]);
    const obs = ys.filter((y) => y === 1).length / ys.length;
    return {
      bin: label,
      n: idx.length,
      meanPredicted: round3(mean(ps)),
      observedRate: round3(obs),
    };
  });
}

function buildMechanismCountTable(population) {
  const eligibleAll = population.filter((c) => c.cycleValid);
  const bands = ["0", "1", "2", "3", "4+"];
  return bands.map((band) => {
    const clients = eligibleAll.filter(
      (c) => mechanismBand(c.totalImplementedMechanisms ?? c.mechanismCount ?? 0) === band,
    );
    const renewed = clients.filter((c) => c.renewed).length;
    return {
      band,
      clients: clients.length,
      renewed,
      renewalRatePct: pct(renewed, clients.length),
      shareOfEligiblePct: pct(clients.length, eligibleAll.length),
    };
  });
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeMetricsCsv(path, rows) {
  const lines = ["metrica;valor;explicacao", ...rows.map((r) => [r.metric, r.value, r.explanation].map(csvEscape).join(";"))];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function writeMechanismsCsv(path, rows) {
  const header = "mechanism_name;clients;renewed;renewal_rate;rate_without;delta_pp;sample_ok";
  const lines = [
    header,
    ...rows.map((r) =>
      [
        r.mechanismName,
        r.eligible,
        r.renewed,
        r.renewalRatePct,
        r.withoutMechanismRatePct,
        r.diffVsWithoutMechanismPp,
        r.smallSample ? "nao" : "sim",
      ]
        .map(csvEscape)
        .join(";"),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

const filters = { status: "active", npsScore: "all", npsClass: "all" };
const dataset = await loadMechanismsSatisfactionDataset();
const raw = await fetchMechanismsSatisfactionRawData();
const { buildInternalMechanismsRenewalProjectionPagePayload } = await import(
  "../lib/analytics/internal-mechanisms-renewal-projection-page.mjs"
);
const pagePayload = buildInternalMechanismsRenewalProjectionPagePayload(dataset, raw, { filters });
const pop = buildCanonicalRenewalPopulation(dataset.wideClients || [], filters);
const popSummaryRaw = pagePayload.modelA?.population || {};
const popSummary = {
  totalInUniverse: popSummaryRaw.canonicalRenewalUniverse,
  eligible: popSummaryRaw.cycleValid,
  renewed: popSummaryRaw.renewed,
  notRenewed: popSummaryRaw.notYetRenewedRegistered,
  withMechanism: popSummaryRaw.withMechanism,
  withoutMechanism: popSummaryRaw.withoutMechanism,
  renewedWithMechanism: popSummaryRaw.renewedWithMechanism,
  renewedWithoutMechanism: popSummaryRaw.renewedWithoutMechanism,
};
const renewalAnalysis = {
  mechanismRanking: pagePayload.modelA?.mechanismRanking || [],
  topByRawRate: pagePayload.modelA?.topByRawRate || [],
  topByAdjustedAssociation: [],
};
const mechRows = renewalAnalysis.mechanismRanking || [];
const topRaw = renewalAnalysis.topByRawRate || [];
const topAssoc = renewalAnalysis.topByAdjustedAssociation || [];
const projection = pagePayload.modelA?.renewalYearEndProjection || {};
const exploratory = projection.exploratory || null;
const modelAudit = exploratory?.modelAudit || {};
const perf = modelAudit.performance || {};
const split = modelAudit.sampleSizes || {};
const splitMeta = modelAudit.split || {};
const horizonMetrics = projection.metrics?.horizon || {};
const expectation = exploratory?.expectation || {};

let calibrationReport = modelAudit.calibrationBins || [];

const activeOfficial = pop.filter((c) => matchesAnalyticalStatusFilter(c.analyticalStatus, "active")).length;
const eligible = pop.filter((c) => c.cycleValid);
const renewed = eligible.filter((c) => c.renewed);
const notYetRenewed = eligible.filter((c) => !c.renewed);

if (exploratory?.modelAudit && exploratory.model) {
  const testPreds = [];
  const testLabels = [];
  const trainingPool = pop.filter((c) => c.cycleValid && (c.renewed === true || c.renewed === false));
  for (const c of trainingPool) {
    const y = c.renewed ? 1 : 0;
    let h = 42;
    const s = String(c.clientId);
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    if ((h % 100) >= 20) continue;
    testLabels.push(y);
    const prog = c.program || "?";
    const band = mechanismBand(c.totalImplementedMechanisms ?? 0);
    const stratum = `${prog}/${band}`;
    const trainRows = trainingPool.filter((t) => {
      let ht = 42;
      const st = String(t.clientId);
      for (let i = 0; i < st.length; i += 1) ht = (ht * 31 + st.charCodeAt(i)) >>> 0;
      return (ht % 100) < 20;
    });
    const global = trainRows.map((t) => (t.renewed ? 1 : 0));
    const baseRate = global.length ? global.filter((x) => x === 1).length / global.length : 0.2;
    const strata = new Map();
    for (const t of trainRows) {
      const k = `${t.program || "?"}/${mechanismBand(t.totalImplementedMechanisms ?? 0)}`;
      if (!strata.has(k)) strata.set(k, { n: 0, events: 0 });
      const s = strata.get(k);
      s.n += 1;
      if (t.renewed) s.events += 1;
    }
    let p = baseRate;
    const hit = strata.get(stratum);
    if (hit && hit.n >= 5) {
      p = (hit.events + 2 * baseRate) / (hit.n + 2);
    }
    p = Math.min(0.95, Math.max(0.05, p));
    testPreds.push(p);
  }
  if (testPreds.length === testLabels.length && testPreds.length) {
    calibrationReport = calibrationBinsReport(testPreds, testLabels);
  }
}

const mechanismCountTable = buildMechanismCountTable(pop);
const generatedAt = new Date().toISOString();
const baselineVersion = `baseline-active-v1-${IMS_RENEWAL_PROJECTION_VERSION}-${CALCULATION_VERSION}`;

const snapshot = {
  population: {
    activeOfficialAnalytical: activeOfficial,
    canonicalRenewalUniverse: popSummary.totalInUniverse,
    cycleValid: popSummary.eligible,
    renewed: popSummary.renewed,
    notYetRenewedRegistered: popSummary.notRenewed,
    withMechanism: popSummary.withMechanism,
    withoutMechanism: popSummary.withoutMechanism,
    renewedWithMechanism: popSummary.renewedWithMechanism,
    renewedWithoutMechanism: popSummary.renewedWithoutMechanism,
    targetNote:
      "renewed_binary=1 se ciclo>1; renewed_binary=0 se ciclo=1 (ainda sem renovação registrada — pode não ter chegado à janela).",
  },
  split: {
    ...splitMeta,
    ...split,
    trainPct: splitMeta.trainShare != null ? Math.round(splitMeta.trainShare * 100) : 80,
    testPct: splitMeta.testShare != null ? Math.round(splitMeta.testShare * 100) : 20,
  },
  model_definition: {
    type: modelAudit.algorithm,
    target: modelAudit.target,
    featuresUsed: modelAudit.featuresUsed,
    featuresExcluded: modelAudit.featuresExcluded,
    formula: {
      taxa_base: "renovados_treino / clientes_treino",
      taxa_ajustada:
        "(renovados_estrato + 2 × taxa_base) / (clientes_estrato + 2) quando N_estrato >= 5",
      fallback: "p_i = taxa_base quando estrato com N < 5",
      clip: "[0,05 ; 0,95]",
      stratumKey: "programa × faixa_mecanismos (0,1,2,3,4+)",
    },
    hyperparameters: modelAudit.hyperparameters,
  },
  parameters: modelAudit.hyperparameters,
  metrics: perf,
  thresholds: modelAudit.thresholdSweep,
  confusion_matrix: {
    threshold: perf.threshold ?? 0.5,
    tp: perf.tp,
    fp: perf.fp,
    tn: perf.tn,
    fn: perf.fn,
  },
  calibration: calibrationReport,
  projection: {
    proxy: "clients.data_fim_ciclo",
    horizonEnd: projection.horizonEnd,
    horizonClients: horizonMetrics.total,
    pharus: horizonMetrics.pharus,
    davos: horizonMetrics.davos,
    byMonth: horizonMetrics.byMonth,
    meanProbabilityPct: expectation.expectedRenewalRatePct,
    expectedRenewals: expectation.expectedRenewals,
    intervalLow: expectation.intervalLow,
    intervalHigh: expectation.intervalHigh,
    modelPublished: projection.modelProjectionPublished,
  },
  mechanism_analysis: {
    countByBand: mechanismCountTable,
    detailedRows: mechRows,
    topRawRate: topRaw,
    topAssociation: topAssoc,
    renewedWithMechanism: popSummary.renewedWithMechanism,
    renewedWithoutMechanism: popSummary.renewedWithoutMechanism,
  },
  utility: modelAudit.utility,
  calculation_version: baselineVersion,
  generated_at: generatedAt,
};

mkdirSync(resolve(root, "exports"), { recursive: true });
mkdirSync(resolve(root, "docs"), { recursive: true });

writeFileSync(
  resolve(root, "exports/modelo_renovacao_base_ativa_snapshot.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

const metricRows = [
  { metric: "ativos_oficiais", value: activeOfficial, explanation: "analyticalStatus === Ativo" },
  { metric: "cycleValid", value: popSummary.eligible, explanation: "Ativos com ciclo válido (>=1)" },
  { metric: "renovados", value: popSummary.renewed, explanation: "cycleValid e ciclo>1" },
  {
    metric: "ainda_sem_renovacao_registrada",
    value: popSummary.notRenewed,
    explanation: "cycleValid e ciclo=1 (não implica falha de renovação)",
  },
  { metric: "accuracy", value: perf.accuracy, explanation: "Holdout 20% hash client_id" },
  { metric: "baseline_accuracy", value: perf.baselineAccuracy, explanation: "Sempre prever não renova" },
  { metric: "balanced_accuracy", value: perf.balancedAccuracy, explanation: "(recall+specificity)/2" },
  { metric: "precision", value: perf.precision, explanation: "TP/(TP+FP) threshold 0,5" },
  { metric: "recall", value: perf.recall, explanation: "TP/(TP+FN)" },
  { metric: "specificity", value: perf.specificity, explanation: "TN/(TN+FP)" },
  { metric: "f1", value: perf.f1, explanation: "F1 no threshold 0,5" },
  { metric: "roc_auc", value: perf.rocAuc, explanation: "Ranking no holdout" },
  { metric: "pr_auc", value: perf.prAuc, explanation: "Classe minoritária renovados" },
  { metric: "brier", value: perf.brier, explanation: "Erro quadrático probabilístico" },
  { metric: "baseline_brier", value: perf.baselineBrier, explanation: "p constante = taxa base" },
  { metric: "tp", value: perf.tp, explanation: "Matriz threshold 0,5" },
  { metric: "fp", value: perf.fp, explanation: "Matriz threshold 0,5" },
  { metric: "tn", value: perf.tn, explanation: "Matriz threshold 0,5" },
  { metric: "fn", value: perf.fn, explanation: "Matriz threshold 0,5" },
  { metric: "n_train", value: split.nTrain, explanation: "80% hash holdout" },
  { metric: "n_test", value: split.nTest, explanation: "20% hash holdout" },
  { metric: "renovados_com_mecanismo", value: popSummary.renewedWithMechanism, explanation: "Elegíveis ativos" },
  { metric: "renovados_sem_mecanismo", value: popSummary.renewedWithoutMechanism, explanation: "Elegíveis ativos" },
  {
    metric: "projecao_clientes_horizonte",
    value: expectation.horizonClients ?? horizonMetrics.total,
    explanation: "Fim de ciclo até 31/12 proxy",
  },
  { metric: "projecao_renovacoes_esperadas", value: expectation.expectedRenewals, explanation: "Soma p_i modelo atual" },
  { metric: "projecao_faixa_baixa", value: expectation.intervalLow, explanation: "85% soma p" },
  { metric: "projecao_faixa_alta", value: expectation.intervalHigh, explanation: "115% soma p" },
];

for (const row of modelAudit.thresholdSweep || []) {
  metricRows.push({
    metric: `threshold_${String(row.threshold).replace(".", "_")}_balanced_accuracy`,
    value: row.balancedAccuracy,
    explanation: `Sweep threshold ${row.threshold}`,
  });
}

writeMetricsCsv(resolve(root, "exports/modelo_renovacao_base_ativa_metricas.csv"), metricRows);
writeMechanismsCsv(
  resolve(root, "exports/modelo_renovacao_base_ativa_mecanismos.csv"),
  (mechRows || []).sort((a, b) => (b.eligible || 0) - (a.eligible || 0)),
);

function mdTable(headers, rows) {
  const h = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${h}\n${sep}\n${body}`;
}

const topRawList = topRaw;
const topAssocList = topAssoc;
const threshRows = (modelAudit.thresholdSweep || []).map((r) => [
  String(r.threshold),
  String(r.tp + r.fp),
  String(r.accuracy),
  String(r.balancedAccuracy),
  String(r.precision),
  String(r.recall),
  String(r.f1),
]);

const calRows = calibrationReport.map((b) => [
  b.bin,
  String(b.n),
  b.meanPredicted == null ? "—" : String(b.meanPredicted),
  b.observedRate == null ? "—" : String(b.observedRate),
]);

const mechDetailRows = (mechRows || [])
  .filter((r) => !r.smallSample)
  .sort((a, b) => (b.eligible || 0) - (a.eligible || 0))
  .slice(0, 25)
  .map((r) => [
    r.mechanismName,
    String(r.eligible),
    String(r.renewed),
    String(r.notRenewed),
    r.renewalRatePct == null ? "—" : `${r.renewalRatePct}%`,
    r.withoutMechanismRatePct == null ? "—" : `${r.withoutMechanismRatePct}%`,
    r.diffVsWithoutMechanismPp == null ? "—" : `${r.diffVsWithoutMechanismPp} p.p.`,
    r.coveragePct == null ? "—" : `${r.coveragePct}%`,
    r.sampleLabel,
  ]);

const countBandRows = mechanismCountTable.map((r) => [
  r.band,
  String(r.clients),
  String(r.renewed),
  r.renewalRatePct == null ? "—" : `${r.renewalRatePct}%`,
  r.shareOfEligiblePct == null ? "—" : `${r.shareOfEligiblePct}%`,
]);

const monthRows = (horizonMetrics.byMonth || []).map((m) => [m.label || m.month || m.key, String(m.count)]);

const report = `# Modelo de Renovação — Referência Base Ativa

*Baseline para futura comparação com metodologia histórica.*

Gerado em: ${generatedAt}  
Versão: \`${baselineVersion}\`  
Fonte: BASE QV (read-only) · população \`analyticalStatus === "Ativo"\` · sem NPS no universo de renovação.

---

## 1. Objetivo

Documentar e congelar o desempenho do **modelo exploratório atual** de renovação, treinado **somente sobre clientes ativos** com ciclo válido, antes de construir (Etapa 2) uma alternativa com base histórica completa.

---

## 2. Quem entra na análise

| Indicador | Valor (live) |
|-----------|--------------|
| Ativos oficiais | ${activeOfficial} |
| Universo canônico de renovação (filtros IMS, status ativo) | ${popSummary.totalInUniverse} |
| Com ciclo válido (elegíveis) | ${popSummary.eligible} |
| Já renovaram (ciclo > 1) | ${popSummary.renewed} |
| Ainda sem renovação registrada (ciclo = 1) | ${popSummary.notRenewed} |
| Com mecanismo implementado | ${popSummary.withMechanism} |
| Sem mecanismo | ${popSummary.withoutMechanism} |

---

## 3. O que significa “renovou”

- **Renovou (rótulo 1):** \`clients.ciclo > 1\` (após parse oficial).
- **Ainda sem renovação registrada (rótulo 0):** \`clients.ciclo = 1\` entre elegíveis.

**Limitação importante:** um cliente **ativo no primeiro ciclo** pode simplesmente **não ter chegado** à janela de renovação. O grupo com rótulo 0 **não** deve ser lido como “clientes que não renovaram” sem essa ressalva.

---

## 4. Como o modelo funciona (sem alteração nesta etapa)

Estimador: **taxas estratificadas** por **programa × faixa de quantidade de mecanismos** (0, 1, 2, 3, 4+), com **shrinkage** e holdout **80/20** por hash de \`client_id\` (seed 42).

Treino: clientes **ativos** com \`cycleValid\` e rótulo binário definido acima. **Não** entram cancelados/congelados no treino.

---

## 5. Fórmula (parâmetros reais do código)

- **taxa_base** = renovados_treino / clientes_treino  
- **taxa_ajustada(k)** = (renovados_estrato + 2 × taxa_base) / (clientes_estrato + 2) quando **N_estrato ≥ 5**  
- Caso contrário: **p_i = taxa_base**  
- **Clip:** p_i ∈ **[0,05 ; 0,95]**

Implementação: \`lib/analytics/internal-mechanisms-renewal-exploratory-projection.mjs\` (\`buildStrataRates\`, \`predictClient\`).

---

## 6. Variáveis usadas na previsão individual

| Entra no predict | Não entra no predict |
|------------------|----------------------|
| Programa (Pharus/Davos) | Mecanismos específicos (ARCADIA, etc.) |
| Faixa 0/1/2/3/4+ de mecanismos | NPS / CSAT |

Mecanismos nomeados aparecem apenas em **análises descritivas** e rankings — **não** na fórmula preditiva.

---

## 7. Treino / teste

| | |
|--|--|
| Treino | ${split.nTrain ?? "—"} (${splitMeta.trainShare != null ? Math.round(splitMeta.trainShare * 100) : 80}%) |
| Teste | ${split.nTest ?? "—"} (${splitMeta.testShare != null ? Math.round(splitMeta.testShare * 100) : 20}%) |
| Renovados treino | ${split.renewedTrain ?? "—"} |
| Não renovados / ainda sem reg. treino | ${split.notRenewedTrain ?? "—"} |
| Renovados teste | ${split.renewedTest ?? "—"} |
| Não renovados / ainda sem reg. teste | ${split.notRenewedTest ?? "—"} |
| Regra split | ${splitMeta.type || "hash holdout client_id, 20% teste"} |

---

## 8. Métricas (holdout — base ativa)

| Métrica | Valor |
|---------|-------|
| Accuracy | ${perf.accuracy ?? "—"} |
| Baseline accuracy | ${perf.baselineAccuracy ?? "—"} |
| Balanced accuracy | ${perf.balancedAccuracy ?? "—"} |
| Precision (t=0,5) | ${perf.precision ?? "—"} |
| Recall | ${perf.recall ?? "—"} |
| Specificity | ${perf.specificity ?? "—"} |
| F1 | ${perf.f1 ?? "—"} |
| ROC-AUC | ${perf.rocAuc ?? "—"} |
| PR-AUC | ${perf.prAuc ?? "—"} |
| Brier | ${perf.brier ?? "—"} |
| Baseline Brier | ${perf.baselineBrier ?? "—"} |

### Explicação simples

- **Accuracy:** acerto global no teste — enganosa se quase todos são “ainda sem renovação registrada”.
- **Baseline accuracy:** sempre chutar “não renova”.
- **Balanced accuracy:** média de sensibilidade e especificidade.
- **Precision / Recall / F1:** trade-off ao marcar “renova” no corte 0,5.
- **ROC-AUC / PR-AUC:** capacidade de **ordenar** quem renova (PR-AUC importante para classe rara).
- **Brier:** erro das probabilidades; útil para **volume** (soma das p).

---

## 9. Matriz de confusão (threshold = ${perf.threshold ?? 0.5})

| | |
|--|--|
| TP | ${perf.tp ?? "—"} |
| FP | ${perf.fp ?? "—"} |
| TN | ${perf.tn ?? "—"} |
| FN | ${perf.fn ?? "—"} |

---

## 10. Sweep de thresholds (teste)

${threshRows.length ? mdTable(["Threshold", "Pred. positivos", "Accuracy", "Bal. acc.", "Precision", "Recall", "F1"], threshRows) : "_Indisponível_"}

---

## 11. Calibração (holdout)

${calRows.length ? mdTable(["Faixa prevista", "N", "Prob. média", "Taxa observada"], calRows) : "_Indisponível_"}

---

## 12. Mecanismos × renovação (base ativa, sem NPS)

Renovados **com** mecanismo: **${popSummary.renewedWithMechanism}** · **sem** mecanismo: **${popSummary.renewedWithoutMechanism}**.

${mechDetailRows.length ? mdTable(["Mecanismo", "Elegíveis", "Renovados", "Ainda s/ reg.", "Taxa", "Taxa s/ mec.", "Δ p.p.", "Cobertura", "Amostra"], mechDetailRows) : "_Sem linhas com amostra suficiente._"}

### Taxa por quantidade de mecanismos

${mdTable(["Qtd", "Clientes", "Renovados", "Taxa", "Participação"], countBandRows)}

### Maiores taxas históricas (amostra ≥ mínimo)

${topRawList.map((r, i) => `${i + 1}. **${r.mechanismName}** — N=${r.eligible ?? r.historicalN}, renovados=${r.renewed ?? r.historicalRenewed}, taxa=${r.renewalRatePct ?? r.historicalRatePct}%`).join("\n") || "—"}

### Maior diferença vs sem o mecanismo (não causal)

${topAssocList.map((r, i) => `${i + 1}. **${r.mechanismName}** — com ${r.renewalRatePct ?? r.historicalRatePct}% vs sem ${r.withoutMechanismRatePct ?? r.rateWithoutPct}% (Δ ${r.diffVsWithoutMechanismPp ?? r.diffPp} p.p., N=${r.eligible ?? r.historicalN})`).join("\n") || "—"}

**Nota:** o Top 3 acima **não** compõe a fórmula preditiva (programa + faixa de contagem).

---

## 13. Projeção até 31/12 (proxy \`data_fim_ciclo\`, só ativos)

| | |
|--|--|
| Clientes no horizonte | ${expectation.horizonClients ?? horizonMetrics.total ?? "—"} |
| Pharus | ${horizonMetrics.pharus ?? "—"} |
| Davos | ${horizonMetrics.davos ?? "—"} |
| Probabilidade média | ${expectation.expectedRenewalRatePct != null ? `${expectation.expectedRenewalRatePct}%` : "—"} |
| Renovações esperadas (soma p) | ${expectation.expectedRenewals ?? "—"} |
| Faixa estimada | ${expectation.intervalLow ?? "—"} – ${expectation.intervalHigh ?? "—"} |

${monthRows.length ? `### Por mês (fim de ciclo)\n\n${mdTable(["Mês", "Clientes"], monthRows)}` : ""}

---

## 14. O que o modelo faz bem / mal

| Uso | Veredito | Base |
|-----|----------|------|
| Ranking | **${modelAudit.utility?.ranking ?? "—"}** | ROC-AUC / PR-AUC |
| Classificação individual | **${modelAudit.utility?.individualClassification ?? "—"}** | precision / recall / F1 |
| Planejamento de volume | **${modelAudit.utility?.volumeEstimate ?? "—"}** | Brier / calibração |

${modelAudit.interpretationPlain ? `\n> ${modelAudit.interpretationPlain}\n` : ""}

---

## 15. Por que comparar com nova metodologia (Etapa 2)?

O modelo atual usa **somente ativos**, evitando misturar cohorts antigas com a operação recente de mecanismos. Porém:

1. Clientes no **1º ciclo** podem ainda não ter passado pela renovação — o rótulo 0 mistura “não chegou lá” com “não renovou”.
2. A **base histórica completa** (Etapa 2) permitirá outro trade-off entre cobertura temporal e viés de permanência.

---

## 16. Não julgar só por accuracy

Com renovados minoritários, prever sempre “não renova” pode dar accuracy alta. A comparação futura deve priorizar **ROC-AUC, PR-AUC, balanced accuracy, recall, Brier, calibração** e erro de **volume projetado**.

---

## Artefatos

- \`exports/modelo_renovacao_base_ativa_snapshot.json\`
- \`exports/modelo_renovacao_base_ativa_metricas.csv\`
- \`exports/modelo_renovacao_base_ativa_mecanismos.csv\`
`;

writeFileSync(resolve(root, "docs/relatorio_modelo_renovacao_base_ativa.md"), report, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      population: snapshot.population,
      split: snapshot.split,
      performance: perf,
      confusion: snapshot.confusion_matrix,
      mechanism: {
        renewedWithMechanism: popSummary.renewedWithMechanism,
        renewedWithoutMechanism: popSummary.renewedWithoutMechanism,
        topRawRate: topRawList.slice(0, 3),
        topAssociation: topAssocList.slice(0, 3),
      },
      projection: snapshot.projection,
      utility: modelAudit.utility,
      artifacts: {
        md: "docs/relatorio_modelo_renovacao_base_ativa.md",
        metricsCsv: "exports/modelo_renovacao_base_ativa_metricas.csv",
        mechanismsCsv: "exports/modelo_renovacao_base_ativa_mecanismos.csv",
        snapshotJson: "exports/modelo_renovacao_base_ativa_snapshot.json",
      },
    },
    null,
    2,
  ),
);
