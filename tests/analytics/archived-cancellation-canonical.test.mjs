import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAnalyticalCancellationMap,
  getAnalyticalCancellation,
  isArchivedCancellationRow,
  classifyClientAnalyticalStatus,
  shouldUseClientDataChurnForAnalytical,
} from "../../lib/analytics/analytical-cancellation.mjs";
import { buildChurnMonthSeries } from "../../lib/analytics/general-metrics.mjs";
import { buildCanonicalAnalyticalChurnRows, buildAnalyticalChurnMonthSeries } from "../../lib/analytics/canonical-churn-series.mjs";
import { buildExecutiveContexts } from "../../lib/analytics/executive-summary-extractors.mjs";
import { defaultExecutiveSummaryFilters } from "../../lib/analytics/executive-summary-filters.mjs";
import { filterCancellationClients } from "../../lib/analytics/cancellations-filters.mjs";
import { buildIntentionVsEffectiveMonthSeries } from "../../lib/analytics/cancellations-metrics.mjs";

const client = (id, extra = {}) => ({ id, status: "Ativo", data_fim_ciclo: "2026-12-31", ...extra });

test("CASO 1 — cancellation ativo com churn_efetivado_at → cancelado", () => {
  const cancellations = [
    {
      client_id: "c1",
      churn_efetivado_at: "2026-03-10",
      archived_at: null,
    },
  ];
  const { map } = buildAnalyticalCancellationMap(cancellations, [client("c1")]);
  assert.equal(map.get("c1")?.isCancelled, true);
  const row = classifyClientAnalyticalStatus("Ativo", map.get("c1"));
  assert.equal(row.analyticalStatus, "Cancelado");
});

test("CASO 2 — só cancellation arquivado com churn → NÃO cancelado", () => {
  const cancellations = [
    {
      client_id: "c2",
      churn_efetivado_at: "2026-03-10",
      archived_at: "2026-04-01",
    },
  ];
  const { map } = buildAnalyticalCancellationMap(cancellations, [client("c2", { data_churn: null })]);
  assert.equal(map.get("c2"), undefined);
  const row = classifyClientAnalyticalStatus("Ativo", null);
  assert.equal(row.analyticalStatus, "Ativo");
});

test("CASO 3 — arquivado + outro válido → cancelado", () => {
  const cancellations = [
    { client_id: "c3", churn_efetivado_at: "2026-01-01", archived_at: "2026-02-01" },
    { client_id: "c3", churn_efetivado_at: "2026-05-01", archived_at: null },
  ];
  const { map } = buildAnalyticalCancellationMap(cancellations, [client("c3")]);
  assert.equal(map.get("c3")?.isCancelled, true);
});

test("CASO 4 — só arquivado + cliente ativo → Ativo", () => {
  const cancellations = [{ client_id: "c4", churn_efetivado_at: "2026-01-01", archived_at: "2026-02-01" }];
  const cl = client("c4");
  assert.equal(shouldUseClientDataChurnForAnalytical(cl, cancellations, "c4"), false);
  const { map } = buildAnalyticalCancellationMap(cancellations, [cl]);
  assert.equal(map.has("c4"), false);
});

test("CASO 5 — só arquivado + cliente congelado → Congelado", () => {
  const cancellations = [{ client_id: "c5", churn_efetivado_at: "2026-01-01", archived_at: "2026-02-01" }];
  const { map } = buildAnalyticalCancellationMap(cancellations, [client("c5", { status: "Congelado" })]);
  assert.equal(map.has("c5"), false);
  const row = classifyClientAnalyticalStatus("Congelado", null);
  assert.equal(row.analyticalStatus, "Congelado");
});

test("CASO 6 — Executive e Cancelamentos churn mensal idêntico", () => {
  const filters = defaultExecutiveSummaryFilters();
  const cancellations = {
    clients: [
      {
        clientId: "a",
        hasEfetivado: true,
        hasConfirmedDate: true,
        effectiveCancellationDate: "2026-05-10",
        analyticalCancellationDate: "2026-05-10",
        isArchived: false,
        analyticalStatus: "Cancelado confirmado",
      },
    ],
    summary: {},
    distributions: {},
  };
  const contexts = buildExecutiveContexts({ general: { clients: [] }, cancellations }, filters);
  const exec = contexts.general.churnMonthSeries;
  const chart = contexts.cancellations.dist.byMonthIntentionVsEffective;
  for (const row of exec) {
    const eff = chart.find((m) => m.month === row.month)?.effective ?? 0;
    assert.equal(row.churnClients, eff, row.month);
  }
});

test("CASO 7/8 — arquivado não entra em série mensal de churn", () => {
  const rows = [
    {
      clientId: "z",
      hasEfetivado: true,
      hasConfirmedDate: true,
      effectiveCancellationDate: "2026-03-01",
      analyticalCancellationDate: "2026-03-01",
      isArchived: true,
      hasArchivedRecord: true,
      analyticalStatus: "Cancelado confirmado",
    },
  ];
  const filtered = filterCancellationClients(rows, { archived: "no", status: "all" });
  assert.equal(buildChurnMonthSeries(filtered, 12).reduce((s, r) => s + r.churnClients, 0), 0);
});

test("isArchivedCancellationRow", () => {
  assert.equal(isArchivedCancellationRow({ archived_at: "2026-01-01" }), true);
  assert.equal(getAnalyticalCancellation({ archived_at: "2026-01-01", churn_efetivado_at: "2026-01-02" }).isCancelled, false);
});
