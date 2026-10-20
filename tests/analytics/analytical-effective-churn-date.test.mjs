import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveEffectiveChurnDate,
  resolveAnalyticalChurnDate,
  auditEffectiveChurnDateAdjustments,
} from "../../lib/analytics/analytical-cancellation.mjs";

test("resolveAnalyticalChurnDate prefere effective", () => {
  assert.equal(
    resolveAnalyticalChurnDate("2026-10-01", "2026-09-01").toISOString().slice(0, 10),
    "2026-09-01",
  );
  assert.equal(
    resolveAnalyticalChurnDate("2026-08-01", null).toISOString().slice(0, 10),
    "2026-08-01",
  );
});

test("effective churn — após fim de ciclo usa data_fim_ciclo", () => {
  const effective = resolveEffectiveChurnDate("2026-10-20", "2026-09-30");
  assert.equal(effective.toISOString().slice(0, 10), "2026-09-30");
});

test("effective churn — antes do fim de ciclo mantém churn", () => {
  const effective = resolveEffectiveChurnDate("2026-08-15", "2026-09-30");
  assert.equal(effective.toISOString().slice(0, 10), "2026-08-15");
});

test("effective churn — sem data_fim_ciclo usa churn", () => {
  const effective = resolveEffectiveChurnDate("2026-08-15", null);
  assert.equal(effective.toISOString().slice(0, 10), "2026-08-15");
});

test("effective churn — sem churn não inventa data", () => {
  assert.equal(resolveEffectiveChurnDate(null, "2026-09-30"), null);
});

test("auditoria — marca adjusted quando churn após ciclo", () => {
  const clients = [{ id: "c1", data_fim_ciclo: "2026-09-30" }];
  const cancelMap = new Map([
    [
      "c1",
      {
        isCancelled: true,
        hasConfirmedDate: true,
        date: new Date("2026-10-20T12:00:00Z"),
      },
    ],
  ]);
  const audit = auditEffectiveChurnDateAdjustments(clients, cancelMap);
  assert.equal(audit.summary.clientesComDataAjustada, 1);
  assert.equal(audit.rows[0].adjusted, true);
  assert.equal(audit.rows[0].effective_churn_date, "2026-09-30");
});
