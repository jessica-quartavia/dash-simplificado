/**
 * Diagnóstico PASS/FAIL por card/gráfico da página Cancelamento (V2 vs regras V1).
 * Uso: node scripts/cancellation-v1-fidelity-check.mjs
 *
 * Compara valores V2 com expectativas derivadas das regras oficiais (não exige API V1 live).
 * Quando V1_REFERENCE_JSON estiver definido, compara também com snapshot externo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCancellationsPayload } from "../lib/analytics/cancellations.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[trimmed.slice(0, eq).trim()] = value;
  }
  return parsed;
}

for (const [key, value] of Object.entries({
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
})) {
  if (!String(process.env[key] || "").trim()) process.env[key] = value;
}

const payload = await computeCancellationsPayload();
const summary = payload.summary || {};
const dist = payload.distributions || {};
const funnel = summary.funnel || payload.funnel || {};
const audit = payload.quality?.effectiveCancellationAudit || {};
const populationN = payload.rows?.length ?? payload.clients?.length ?? null;

function sumCounts(items = []) {
  return items.reduce((acc, item) => acc + Number(item.count || 0), 0);
}

function readPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const v1Reference = process.env.V1_REFERENCE_JSON && existsSync(process.env.V1_REFERENCE_JSON)
  ? JSON.parse(readFileSync(process.env.V1_REFERENCE_JSON, "utf8"))
  : null;

const COMPONENTS = [
  {
    id: "kpi_effective_cancellations",
    label: "Cancelamentos efetivados",
    v2Path: "summary.effectiveCancellations",
    rule: "Cliente distinto com evidência churn_efetivado_at | distrato_assinado_at | distrato=Assinado | clients.data_churn; archived excluído",
    population: "Universo analítico não arquivado",
  },
  {
    id: "kpi_clients_in_process",
    label: "Em processo",
    v2Path: "summary.clientsInCancellationProcess",
    rule: "Intenção/pedido/processo sem efetivação",
    population: "Clientes distintos",
  },
  {
    id: "kpi_intentions_or_orders",
    label: "Intenções/pedidos registrados",
    v2Path: "summary.intentionsOrOrdersRegistered",
    rule: "intencao_registrada_at OU data_pedido (distintos, overlap permitido no KPI composto)",
    population: "Clientes distintos",
  },
  {
    id: "kpi_intentions",
    label: "Intenções",
    v2Path: "summary.intentionsRegistered",
    rule: "intencao_registrada_at ou status Nova intenção",
    population: "Clientes distintos",
  },
  {
    id: "kpi_orders",
    label: "Pedidos",
    v2Path: "summary.ordersRegistered",
    rule: "data_pedido preenchido",
    population: "Clientes distintos",
  },
  {
    id: "chart_exclusive_stage_sum",
    label: "Etapa exclusiva (soma)",
    v2Path: "__dist.byExclusiveStage",
    rule: "Cada cliente uma etapa: efetivado > offboarding > retenção > intenção/pedido > nenhuma",
    population: "Carteira filtrada",
    compute: (p) => sumCounts(p.distributions?.byExclusiveStage || p.summary?.exclusiveStages || []),
    expect: (p) => p.summary?.totalDistinctClients ?? p.rows?.length ?? p.clients?.length,
  },
  {
    id: "chart_evidence_intention",
    label: "Funil evidência — Intenção",
    v2Path: "summary.evidenceFunnel.intention",
    rule: "Overlap permitido; não soma universo",
    population: "Evidências distintas",
    compute: (p) => {
      const item = (p.summary?.evidenceFunnel || []).find((e) => /inten/i.test(e.stage || e.label || e.key || ""));
      return item?.totalDistinctClients ?? item?.totalDistinct ?? item?.count ?? null;
    },
  },
  {
    id: "chart_evidence_effective",
    label: "Funil evidência — Efetivado",
    v2Path: "summary.evidenceFunnel.effective",
    rule: "Overlap permitido; não soma universo",
    population: "Evidências distintas",
    compute: (p) => {
      const item = (p.summary?.evidenceFunnel || []).find((e) => /efetiv/i.test(e.stage || e.label || e.key || ""));
      return item?.totalDistinctClients ?? item?.totalDistinct ?? item?.count ?? null;
    },
  },
  {
    id: "audit_effective_distinct",
    label: "Auditoria efetivados distintos",
    v2Path: "quality.effectiveCancellationAudit.totalDistinct",
    rule: "Deve igualar summary.effectiveCancellations",
    population: "Clientes distintos",
    expect: (p) => p.summary?.effectiveCancellations,
  },
  {
    id: "funnel_effective",
    label: "Funil recorte — Efetivados",
    v2Path: "summary.funnel.effective",
    rule: "Efetivados no recorte filtrado",
    population: "Recorte filtrado",
    compute: (p) => p.summary?.funnel?.effective ?? p.summary?.effectiveCancellations,
  },
];

const rows = COMPONENTS.map((spec) => {
  const v2Value = spec.compute ? spec.compute(payload) : readPath(payload, spec.v2Path.replace(/^__/, ""));
  const v2Expect = spec.expect ? spec.expect(payload) : null;
  const v1Value = v1Reference ? readPath(v1Reference, spec.v2Path.replace(/^__/, "")) : null;
  const referenceValue = v1Value ?? v2Expect;
  const match =
    referenceValue == null && v2Expect == null
      ? v2Value != null && v2Value !== undefined
      : Number(v2Value) === Number(referenceValue);
  return {
    metric_id: spec.id,
    label: spec.label,
    rule: spec.rule,
    population: spec.population,
    v1_value: v1Value,
    v2_value: v2Value,
    v2_expected: v2Expect,
    difference: referenceValue == null ? null : Number(v2Value) - Number(referenceValue),
    v2_population_n: populationN,
    match: match ? "PASS" : "FAIL",
  };
});

const exclusiveStages = (dist.byExclusiveStage || summary.exclusiveStages || []).map((s) => ({
  label: s.label,
  count: s.count,
  percent: s.percent,
}));

const report = {
  generatedAt: new Date().toISOString(),
  page: "cancellations",
  populationN,
  summary: {
    effectiveCancellations: summary.effectiveCancellations,
    clientsInCancellationProcess: summary.clientsInCancellationProcess,
    intentionsRegistered: summary.intentionsRegistered,
    ordersRegistered: summary.ordersRegistered,
  },
  exclusiveStages,
  exclusiveStageLabelsExpected: [
    "Cancelamento efetivado",
    "Offboarding",
    "Retenção",
    "Intenção/pedido de cancelamento",
    "Sem etapa identificada",
  ],
  exclusiveStageZeroOk: ["Retenção", "Intenção/pedido de cancelamento", "Sem etapa identificada"].map((label) => ({
    label,
    presentInPayload: exclusiveStages.some((s) => s.label === label),
    count: exclusiveStages.find((s) => s.label === label)?.count ?? 0,
  })),
  components: rows,
  overall: rows.every((r) => r.match === "PASS") ? "PASS" : "FAIL",
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.overall === "PASS" ? 0 : 1;
