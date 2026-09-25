/**
 * ETAPA 2 — Modelo B histórico + comparação com snapshot Modelo A.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CALCULATION_VERSION } from "../lib/cache/analytics-cache.mjs";
import {
  fetchMechanismsSatisfactionRawData,
  mechanismSlugFromName,
} from "../lib/analytics/mechanisms-satisfaction-dataset.mjs";
import { buildAnalyticalCancellationMap } from "../lib/analytics/analytical-cancellation.mjs";
import { excludedClientIds, filterExcludedClients } from "../lib/analytics/data-exclusions.mjs";
import { blankToNull, parseDate } from "../lib/analytics/meeting-metrics.mjs";
import { dedupeClientMechanisms } from "../lib/analytics/mechanism-metrics.mjs";
import {
  buildMechanismAdoptionSeries,
  proposeMechanismEraCutoffs,
  MECHANISM_ERA_START_PRIMARY,
} from "../lib/analytics/internal-mechanisms-renewal-historical-adoption.mjs";
import {
  buildCanonicalHistoricalRenewalPopulation,
  summarizeHistoricalPopulation,
} from "../lib/analytics/internal-mechanisms-renewal-historical-population.mjs";
import {
  trainHistoricalStratifiedModel,
  mechanismCountBandTable,
  historicalMechanismAnalysis,
  populationQualityVerdict,
  temporalValidationVerdict,
  comparisonDimensionVerdicts,
} from "../lib/analytics/internal-mechanisms-renewal-historical-model.mjs";
import { civilDateInSaoPaulo } from "../lib/analytics/client-cycle-renewal.mjs";

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

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loadModelASnapshot() {
  const path = resolve(root, "exports/modelo_renovacao_base_ativa_snapshot.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildFinancialMap(financialRows) {
  const map = new Map();
  for (const row of financialRows || []) {
    const clientId = blankToNull(row.client_id);
    if (!clientId) continue;
    const updated = parseDate(row.updated_at) || new Date(0);
    const current = map.get(String(clientId));
    if (current && current.updated >= updated) continue;
    map.set(String(clientId), {
      updated,
      monthlyIncome: row.ultima_renda_mensal,
      liquidityReserve: row.reserva_liquidez,
      lastContribution: row.ultimo_aporte,
      paidPropertiesValue: row.valor_imoveis_quitados,
      debt: {},
    });
  }
  return map;
}

const raw = await fetchMechanismsSatisfactionRawData();
const removedIds = excludedClientIds(raw.clientsRaw || []);
const clients = filterExcludedClients(raw.clientsRaw || []);
const cancellations = (raw.cancelRaw || []).filter((row) => !removedIds.has(String(row.client_id || "")));
const { map: cancelMap } = buildAnalyticalCancellationMap(cancellations, clients);
const { rows: cmRows } = dedupeClientMechanisms(
  (raw.cmRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
);
const financialMap = buildFinancialMap(
  (raw.finRaw || []).filter((row) => !removedIds.has(String(row.client_id || ""))),
);
const mechMap = new Map((raw.mechRaw || []).map((m) => [String(m.id), m]));
const catalog = (raw.mechRaw || []).map((m) => ({
  id: m.id,
  name: m.name,
  slug: mechanismSlugFromName(m.name),
}));

const adoption = buildMechanismAdoptionSeries(cmRows, clients, cancelMap);
const eraProposal = proposeMechanismEraCutoffs(adoption);

function runCutoff(cutoff) {
  const built = buildCanonicalHistoricalRenewalPopulation({
    clients,
    cmRows,
    mechMap,
    cancelMap,
    financialMap,
    eraStart: cutoff.eraStart,
    today: civilDateInSaoPaulo(),
  });
  const summary = summarizeHistoricalPopulation(built.population);
  const model = trainHistoricalStratifiedModel(built.population);
  return { cutoff, built, summary, model };
}

const sensitivity = eraProposal.cutoffs.map((c) => runCutoff(c));
const primaryCutoff =
  eraProposal.cutoffs.find((c) => c.id === MECHANISM_ERA_START_PRIMARY)
  || eraProposal.cutoffs.find((c) => c.id === "intermediate")
  || eraProposal.cutoffs[0];
const primary = sensitivity.find((s) => s.cutoff.id === primaryCutoff?.id) || sensitivity[0];

const modelA = loadModelASnapshot();
const perfA = modelA.metrics || {};
const perfB = primary?.model?.performance || {};
const popB = primary?.summary || {};
const exclB = primary?.built?.excluded || {};

const mechB = historicalMechanismAnalysis(primary.built.population, catalog, 30);
const bandsB = mechanismCountBandTable(primary.built.population);

const comparisonRows = [
  ["metrica", "modelo_a", "modelo_b"],
  ["populacao", modelA.population?.cycleValid, popB.total],
  ["n_treino", modelA.split?.nTrain, primary.model?.trainRows?.length],
  ["n_teste", modelA.split?.nTest, primary.model?.testRows?.length],
  ["taxa_base", modelA.split?.baseRate, primary.model?.baseRate],
  ["accuracy", perfA.accuracy, perfB.accuracy],
  ["baseline_accuracy", perfA.baselineAccuracy, perfB.baselineAccuracy],
  ["balanced_accuracy", perfA.balancedAccuracy, perfB.balancedAccuracy],
  ["precision", perfA.precision, perfB.precision],
  ["recall", perfA.recall, perfB.recall],
  ["f1", perfA.f1, perfB.f1],
  ["roc_auc", perfA.rocAuc, perfB.rocAuc],
  ["pr_auc", perfA.prAuc, perfB.prAuc],
  ["brier", perfA.brier, perfB.brier],
  ["baseline_brier", perfA.baselineBrier, perfB.baselineBrier],
];

const generatedAt = new Date().toISOString();
const popQuality = populationQualityVerdict(popB, exclB);
const dimensionVerdicts = comparisonDimensionVerdicts(modelA, primary.model, popQuality);

const snapshotB = {
  modelId: "B1_historical_stratified",
  calculation_version: `historical-b1-v1-${CALCULATION_VERSION}`,
  generated_at: generatedAt,
  mechanism_era: eraProposal,
  primary_cutoff: primary.cutoff,
  population: { summary: popB, excluded: exclB, exposureRule: primary.built.exposureRule },
  split: primary.model?.modelAudit?.split,
  splitTemporalIllustrative: primary.model?.splitMeta?.temporalIllustrative,
  sampleSizes: primary.model?.modelAudit?.sampleSizes,
  metrics: perfB,
  thresholds: primary.model?.modelAudit?.thresholdSweep,
  confusion_matrix: {
    threshold: perfB.threshold ?? 0.5,
    tp: perfB.tp,
    fp: perfB.fp,
    tn: perfB.tn,
    fn: perfB.fn,
  },
  calibration: primary.model?.modelAudit?.calibrationBins,
  mechanism_analysis: { bands: bandsB, ...mechB },
  sensitivity: sensitivity.map((s) => ({
    cutoff: s.cutoff,
    summary: s.summary,
    metrics: s.model?.performance || null,
    available: s.model?.available,
  })),
  quality: {
    population: popQuality,
    temporalValidation: temporalValidationVerdict(primary.model),
    utility: primary.model?.utility,
    comparisonDimensions: dimensionVerdicts,
  },
  model_a_reference: "exports/modelo_renovacao_base_ativa_snapshot.json",
  b2_features_audit: {
    tenure_days_at_reference: "Disponível; reference_date antes do desfecho.",
    mechanism_slugs: "Point-in-time; não entram no predict B1.",
    meetings: "Não reconstruído nesta etapa.",
    segment: "Disponível; fora do B1.",
    program: "Usado no B1.",
    note: "B2 não implementado.",
  },
};

mkdirSync(resolve(root, "exports"), { recursive: true });
mkdirSync(resolve(root, "docs"), { recursive: true });

writeFileSync(
  resolve(root, "exports/modelo_renovacao_historico_snapshot.json"),
  `${JSON.stringify(snapshotB, null, 2)}\n`,
  "utf8",
);

writeFileSync(
  resolve(root, "exports/modelo_renovacao_comparacao_A_B.csv"),
  `${comparisonRows.map((r) => r.map(csvEscape).join(";")).join("\n")}\n`,
  "utf8",
);

const popAuditLines = [
  "cutoff_id;era_start;N;renewed;not_renewed;with_mechanism;without_mechanism;renewal_rate_pct;excluded_before_era;excluded_exposure;excluded_open;roc_auc;pr_auc;brier",
  ...sensitivity.map((s) =>
    [
      s.cutoff.id,
      s.cutoff.eraStart,
      s.summary.total,
      s.summary.renewed,
      s.summary.notRenewed,
      s.summary.withMechanism,
      s.summary.withoutMechanism,
      s.summary.renewalRatePct,
      s.built.excluded.before_era,
      s.built.excluded.insufficient_exposure,
      s.built.excluded.outcome_still_open,
      s.model?.performance?.rocAuc,
      s.model?.performance?.prAuc,
      s.model?.performance?.brier,
    ]
      .map(csvEscape)
      .join(";"),
  ),
  "",
  "month;clients_first_impl;total_impl;active_approx;cumulative_clients;exposure_pct",
  ...adoption.monthly.map((m) =>
    [
      m.month,
      m.clientsFirstImplementation,
      m.totalImplementations,
      m.activeClientsApprox,
      m.cumulativeClientsWithImplementation,
      m.portfolioExposurePct,
    ]
      .map(csvEscape)
      .join(";"),
  ),
];
writeFileSync(
  resolve(root, "exports/modelo_renovacao_historico_population_audit.csv"),
  `${popAuditLines.join("\n")}\n`,
  "utf8",
);

const metricRows = [
  ["metrica", "valor", "explicacao"],
  ["era_start_primary", primary.cutoff.eraStart, primary.cutoff.rule],
  ["population_n", popB.total, "Casos resolvidos na era"],
  ["renewed", popB.renewed, "ciclo>1 observado"],
  ["not_renewed", popB.notRenewed, "desfecho negativo observável"],
  ...Object.entries(perfB).map(([k, v]) => [k, v, "Holdout temporal B1"]),
];
writeFileSync(
  resolve(root, "exports/modelo_renovacao_historico_metricas.csv"),
  `${metricRows.map((r) => r.map(csvEscape).join(";")).join("\n")}\n`,
  "utf8",
);

const mechCsvHeader =
  "mechanism_name;clients;renewed;renewal_rate;rate_without;delta_pp;sample_ok";
writeFileSync(
  resolve(root, "exports/modelo_renovacao_historico_mecanismos.csv"),
  `${mechCsvHeader}\n${(mechB.rows || [])
    .map((r) =>
      [
        r.mechanismName,
        r.clients,
        r.renewed,
        r.renewalRatePct,
        r.rateWithoutPct,
        r.deltaPp,
        r.sampleOk ? "sim" : "nao",
      ]
        .map(csvEscape)
        .join(";"),
    )
    .join("\n")}\n`,
  "utf8",
);

function mdTable(h, rows) {
  return `| ${h.join(" | ")} |\n| ${h.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
}

function fmt(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return String(v);
  return String(v);
}

const perfAFull = modelA.metrics || {};
const thresholdsB = primary.model?.modelAudit?.thresholdSweep || [];
const calB = primary.model?.modelAudit?.calibrationBins || [];
const splitNote = primary.model?.modelAudit?.split?.referenceDateConfoundingNote;
const tempIll = primary.model?.splitMeta?.temporalIllustrative;

const comparisonMd = mdTable(
  ["Métrica", "Modelo A", "Modelo B"],
  comparisonRows.slice(1).map((r) => [r[0], fmt(r[1]), fmt(r[2])]),
);

const dimensionMd = mdTable(
  ["Dimensão", "Modelo B"],
  [
    ["Ranking (ROC/PR)", dimensionVerdicts.ranking],
    ["Classificação", dimensionVerdicts.individualClassification],
    ["Volume / calibração", dimensionVerdicts.volumeEstimate],
    ["Qualidade da população", dimensionVerdicts.populationQuality],
    ["Validação temporal", dimensionVerdicts.temporalValidation],
  ],
);

const report = `# Modelo B — Histórico temporalmente comparável

Gerado: ${generatedAt}

## Resumo leigo

**Modelo A:** aprende apenas com clientes **ativos** (snapshot atual).

**Modelo B:** aprende com **histórico resolvido** — só entram clientes da **era dos mecanismos**, com **exposição mínima auditada** e desfecho de renovação **já observável**. Usar os 3k+ clientes direto mistura épocas sem mecanismos com “não renovou” e distorce o target.

**Produção:** continua no Modelo A (projeção 31/12 intacta). Modelo B é experimento offline.

---

## 1. Por que criamos o Modelo B

Comparar o mesmo estimador (programa × faixa de mecanismos) numa população **temporalmente justa**, incluindo cancelados e ciclos encerrados, sem tratar pré-era como “sem mecanismo + não renovou”.

## 2. Problema de usar a base inteira diretamente

Antes da adoção sistemática, clientes não tinham oportunidade real de mecanismos; o target histórico misturaria **não renovou** com **ainda não estava na operação de mecanismos**.

## 3. Início da era dos mecanismos

| Marco | Valor |
| --- | --- |
| Primeira implementação registrada | ${adoption.firstImplementationDate ?? "—"} |
| Início experimental (série) | ${eraProposal.experimentalStart ?? "—"} |
| Adoção relevante | ${eraProposal.relevantAdoptionMonth ?? "—"} |
| Estabilização operacional (3 meses) | ${eraProposal.stabilizationMonth ?? "—"} |
| **MECHANISM_ERA_START (primário)** | ${primary.cutoff.eraStart} — ${primary.cutoff.rule} |

Série mensal completa: \`exports/modelo_renovacao_historico_population_audit.csv\`.

## 4. Regra de exposição

${primary.built.exposureRule.definition}

Parâmetros: mínimo **${primary.built.exposureRule.minExposureDays}** dias (P25 auditado: ${primary.built.exposureRule.p25ExposureDays ?? "—"}).

## 5. Quem entra

População canônica \`canonicalHistoricalRenewalPopulation\` (primário: corte **${primary.cutoff.label}**).

| | N |
| --- | ---: |
| Total resolvido | ${popB.total} |
| Renovados | ${popB.renewed} |
| Não renovados | ${popB.notRenewed} |
| Com mecanismo (antes de reference_date) | ${popB.withMechanism} |
| Sem mecanismo | ${popB.withoutMechanism} |
| Taxa base | ${popB.renewalRatePct}% |

## 6. Quem fica de fora

| Motivo | N |
| --- | ---: |
| Antes da era | ${exclB.before_era ?? 0} |
| Exposição insuficiente | ${exclB.insufficient_exposure ?? 0} |
| Resultado ainda aberto | ${exclB.outcome_still_open ?? 0} |
| Ciclo inválido | ${exclB.invalid_cycle ?? 0} |
| Sem reference_date | ${exclB.missing_reference ?? 0} |

## 7. Target

- **y=1:** renovação observada (ciclo > 1).
- **y=0:** cancelamento sem renovação ou janela de ciclo encerrada sem renovação (\`data_fim_ciclo\` como proxy B, validado na Etapa 1).
- Excluídos: desfecho ainda aberto (“ainda não chegou à renovação” ≠ “não renovou”).
- Features e contagem de mecanismos: somente implementações com \`implementation_date <= reference_date\`.

## 8. Modelo B1

Mesmo estimador do Modelo A: **programa × faixa (0/1/2/3/4+)** com shrinkage, \`minStratumN=${5}\`, clip [0,05–0,95]. Objetivo: isolar efeito da **população**.

## 9. Treino / teste

| | Modelo B |
| --- | --- |
| Tipo (métricas oficiais B1) | ${primary.model?.modelAudit?.split?.type ?? "—"} |
| Primário | ${primary.model?.modelAudit?.split?.primary ?? "—"} |
| Treino | ${primary.model?.trainRows?.length ?? "—"} (eventos: ${primary.model?.modelAudit?.split?.eventsTrain ?? "—"}) |
| Teste | ${primary.model?.testRows?.length ?? "—"} (eventos: ${primary.model?.modelAudit?.split?.eventsTest ?? "—"}) |
| Data de corte temporal | ${primary.model?.modelAudit?.split?.splitDate ?? "—"} |

${splitNote ? `> **Validação temporal:** ${splitNote}` : ""}

${tempIll?.feasible ? `**Split temporal ilustrativo** (não usado como métrica principal): corte ${tempIll.splitDate}, treino ${tempIll.trainN}, teste ${tempIll.testN}, ROC-AUC ${fmt(tempIll.rocAuc)}, Brier ${fmt(tempIll.brier)}. ${tempIll.warning}` : tempIll?.reason ? `Split temporal ilustrativo: ${tempIll.reason}` : ""}

Modelo A: hash holdout 80/20 (seed 42), n treino ${modelA.split?.nTrain}, n teste ${modelA.split?.nTest}.

## 10. Métricas

${comparisonMd}

### Modelo B — limiares (matriz de confusão)

${mdTable(
  ["Limiar", "TP", "FP", "TN", "FN", "Accuracy", "Recall", "F1"],
  (thresholdsB.length ? thresholdsB : [{ threshold: 0.5, ...perfB }]).map((t) => [
    String(t.threshold),
    String(t.tp ?? "—"),
    String(t.fp ?? "—"),
    String(t.tn ?? "—"),
    String(t.fn ?? "—"),
    fmt(t.accuracy),
    fmt(t.recall),
    fmt(t.f1),
  ]),
)}

## 11. Calibração (holdout B1)

${mdTable(
  ["Bin", "N", "Previsto", "Observado"],
  calB.map((b) => [b.bin, String(b.n), fmt(b.meanPredicted), fmt(b.observedRate)]),
)}

## 12. Mecanismos × renovação (população B)

Arquivo \`exports/modelo_renovacao_historico_mecanismos.csv\`.

**Top taxa bruta (N≥30):** ${mechB.topRawRate.map((r) => `${r.mechanismName} (${r.renewalRatePct}%)`).join("; ") || "—"}

**Top delta vs sem mecanismo:** ${mechB.topDelta.map((r) => `${r.mechanismName} (+${r.deltaPp} p.p.)`).join("; ") || "—"}

### Faixas de quantidade (antes da janela)

${mdTable(
  ["Faixa", "N", "Renovados", "Taxa %"],
  bandsB.map((b) => [b.band, String(b.clients), String(b.renewed), fmt(b.renewalRatePct)]),
)}

## 13. Sensibilidade à data de corte da era

${mdTable(
  ["Corte", "N", "Taxa %", "ROC-AUC", "PR-AUC", "Brier", "Modelo OK"],
  sensitivity.map((s) => [
    s.cutoff.id,
    String(s.summary.total),
    String(s.summary.renewalRatePct ?? "—"),
    fmt(s.model?.performance?.rocAuc),
    fmt(s.model?.performance?.prAuc),
    fmt(s.model?.performance?.brier),
    s.model?.available ? "sim" : "não",
  ]),
)}

${sensitivity.some((s, i, arr) => {
  const rocs = arr.filter((x) => x.model?.performance?.rocAuc != null).map((x) => x.model.performance.rocAuc);
  if (rocs.length < 2) return false;
  return Math.max(...rocs) - Math.min(...rocs) > 0.15;
}) ? "**Alerta:** métricas sensíveis ao corte da era — interpretar com cautela." : ""}

## 14. Comparação com Modelo A

- **Onde A tende a ser mais forte:** ranking (ROC-AUC ${fmt(perfAFull.rocAuc)} vs ${fmt(perfB.rocAuc)}), base ativa alinhada à projeção de produção.
- **Onde B contribui:** target histórico mais justo para cancelados/ciclos fechados; taxa base observada ${popB.renewalRatePct}% vs ~${fmt(modelA.split?.baseRate != null ? Math.round(modelA.split.baseRate * 1000) / 10 : null)}% (A, ativos).
- **Não declarar vencedor automático** — ver dimensões abaixo.

${dimensionMd}

## 15. Limitações

- \`reference_date\` para renovados usa \`data_fim_ciclo\` (muitas datas futuras) — impede holdout temporal balanceado; métricas B1 espelham hash do A.
- Proxy B para não renovação; reuniões/NPS não entram no B1.
- B2 (variáveis extras) **não implementado**.

## 16. Próximos passos

- Refinar data de decisão de renovação (pré-evento) para validação out-of-time real.
- Avaliar B2 só após auditoria de leakage (\`b2_features_audit\` no snapshot).
- Manter projeção de produção no Modelo A até decisão explícita.

---

## Resultado final (checklist)

### Era dos mecanismos
- Primeira implementação: ${adoption.firstImplementationDate ?? "—"}
- Adoção relevante: ${eraProposal.relevantAdoptionMonth ?? "—"}
- Cutoffs testados: ${eraProposal.cutoffs.map((c) => `${c.id}=${c.eraStartMonth}`).join(", ")}

### População B (primário)
- N: ${popB.total} | renovados: ${popB.renewed} | não renovados: ${popB.notRenewed}
- com mecanismo: ${popB.withMechanism} | sem: ${popB.withoutMechanism}

### Excluídos
- antes da era: ${exclB.before_era} | sem exposição: ${exclB.insufficient_exposure} | aberto: ${exclB.outcome_still_open} | outros: ${(exclB.invalid_cycle ?? 0) + (exclB.missing_reference ?? 0)}

### Split B1
- tipo: ${primary.model?.modelAudit?.split?.type}
- treino: ${primary.model?.trainRows?.length} | teste: ${primary.model?.testRows?.length}

### Performance B
accuracy ${fmt(perfB.accuracy)} | baseline ${fmt(perfB.baselineAccuracy)} | balanced ${fmt(perfB.balancedAccuracy)} | precision ${fmt(perfB.precision)} | recall ${fmt(perfB.recall)} | F1 ${fmt(perfB.f1)} | ROC-AUC ${fmt(perfB.rocAuc)} | PR-AUC ${fmt(perfB.prAuc)} | Brier ${fmt(perfB.brier)} | baseline Brier ${fmt(perfB.baselineBrier)}

### Performance A
accuracy ${fmt(perfAFull.accuracy)} | balanced ${fmt(perfAFull.balancedAccuracy)} | recall ${fmt(perfAFull.recall)} | F1 ${fmt(perfAFull.f1)} | ROC-AUC ${fmt(perfAFull.rocAuc)} | PR-AUC ${fmt(perfAFull.prAuc)} | Brier ${fmt(perfAFull.brier)}

### Recomendação
Não escolher vencedor só por accuracy. A permanece na produção; B informa coerência populacional e limites do proxy temporal.

### Segurança
BASE QV read-only · V1 intacto · Modelo A intacto · Git não executado

---

Artefatos: \`exports/modelo_renovacao_historico_*.csv/json\`, \`docs/relatorio_modelo_renovacao_historico.md\`.
`;

writeFileSync(resolve(root, "docs/relatorio_modelo_renovacao_historico.md"), report, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      era: {
        firstImplementation: adoption.firstImplementationDate,
        experimentalStart: eraProposal.experimentalStart,
        cutoffs: eraProposal.cutoffs,
        primary: primary.cutoff,
      },
      populationB: popB,
      excluded: exclB,
      splitB: primary.model?.modelAudit?.split,
      performanceB: perfB,
      performanceA: {
        accuracy: perfA.accuracy,
        balancedAccuracy: perfA.balancedAccuracy,
        recall: perfA.recall,
        f1: perfA.f1,
        rocAuc: perfA.rocAuc,
        prAuc: perfA.prAuc,
        brier: perfA.brier,
      },
      sensitivity: sensitivity.map((s) => ({
        id: s.cutoff.id,
        N: s.summary.total,
        rocAuc: s.model?.performance?.rocAuc,
        prAuc: s.model?.performance?.prAuc,
        brier: s.model?.performance?.brier,
      })),
      quality: snapshotB.quality,
      topRaw: mechB.topRawRate,
      topDelta: mechB.topDelta,
      artifacts: {
        md: "docs/relatorio_modelo_renovacao_historico.md",
        metricsCsv: "exports/modelo_renovacao_historico_metricas.csv",
        populationAuditCsv: "exports/modelo_renovacao_historico_population_audit.csv",
        comparisonCsv: "exports/modelo_renovacao_comparacao_A_B.csv",
        snapshotJson: "exports/modelo_renovacao_historico_snapshot.json",
      },
    },
    null,
    2,
  ),
);
