import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAcquisitionChurnBalanceSeries,
  buildChurnMonthSeries,
} from "../../lib/analytics/general-metrics.mjs";

test("balança mensal = aquisição − churn", () => {
  const balance = buildAcquisitionChurnBalanceSeries(
    [{ month: "2026-01", acquiredClients: 5 }],
    [{ month: "2026-01", churnClients: 2 }],
  );
  assert.equal(balance[0].balance, 3);
});

test("churn mensal ignora intenção sem status cancelado confirmado", () => {
  const series = buildChurnMonthSeries(
    [
      { analyticalStatus: "Ativo", effectiveCancellationDate: "2026-01-15" },
      {
        analyticalStatus: "Cancelado confirmado",
        effectiveCancellationDate: "2026-01-20",
      },
    ],
    6,
    new Date("2026-06-01T12:00:00Z"),
  );
  const jan = series.find((r) => r.month === "2026-01");
  assert.equal(jan?.churnClients, 1);
});
