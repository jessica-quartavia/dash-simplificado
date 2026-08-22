import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRestPageSize, resolveRestRangeSize, TABLE_PAGE_SIZES } from "../../lib/data/supabase-rest.mjs";
import {
  buildOfficialNpsProgramBreakdown,
  toPublicSatisfactionPayload,
} from "../../lib/analytics/satisfaction.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contextSource = readFileSync(resolve(root, "lib/analytics/analytics-data-context.mjs"), "utf8");

test("selects canônicos não usam wildcard", () => {
  assert.doesNotMatch(contextSource, /CANONICAL_SELECT[\s\S]*select:\s*"\*"/);
  assert.match(contextSource, /clients:\s*\n\s*"id,codigo/);
  assert.match(contextSource, /client_meetings:/);
  assert.match(contextSource, /nps_responses:/);
});

test("select canônico NPS não inclui raw_payload", () => {
  assert.doesNotMatch(contextSource, /nps_responses:[\s\S]*raw_payload/);
  assert.match(contextSource, /submitted_at/);
});

test("page size por tabela — meetings usa 5000", () => {
  assert.equal(resolveRestPageSize("client_meetings"), TABLE_PAGE_SIZES.client_meetings);
  assert.equal(TABLE_PAGE_SIZES.client_meetings, 5000);
});

test("fetchKey usa select normalizado (ordem de colunas)", () => {
  assert.match(contextSource, /function normalizeSelectKey/);
  assert.match(contextSource, /select: normalizeSelectKey/);
});

test("toPublicSatisfactionPayload remove raw_payload de scopeInputs", () => {
  const payload = {
    summary: { nps: 42 },
    scopeInputs: {
      allNpsRows: [
        {
          id: "1",
          client_id: "c1",
          score: 10,
          created_at: "2026-01-01",
          submitted_at: "2026-01-01",
          raw_payload: { huge: true },
          comment: "ok",
        },
      ],
      allCsatRows: [
        {
          id: "2",
          client_id: "c1",
          score: 5,
          created_at: "2026-01-01",
          raw_payload: { huge: true },
        },
      ],
      npsQuarterly: [],
      totalClients: 1,
      clientPrograms: [],
      clientBasics: [],
      npsSends: [],
    },
  };
  const clientMap = new Map([["c1", { id: "c1", programa: "Pharus" }]]);
  const before = buildOfficialNpsProgramBreakdown(payload.scopeInputs.allNpsRows, clientMap);
  const pub = toPublicSatisfactionPayload(payload);
  const after = buildOfficialNpsProgramBreakdown(pub.scopeInputs.allNpsRows, clientMap);
  assert.equal(before.breakdown.total.nps, after.breakdown.total.nps);
  assert.equal(JSON.stringify(pub.scopeInputs.allNpsRows[0]).includes("raw_payload"), false);
});

test("paginação continua quando batch preenche rangeSize mas não pageSize declarado", () => {
  const source = readFileSync(resolve(root, "lib/data/supabase-rest.mjs"), "utf8");
  assert.match(source, /offset \+= batch\.length/);
  assert.match(source, /batch\.length < rangeSize/);
  assert.equal(resolveRestRangeSize("client_meetings"), 1000);
});

test("supabase-rest page size configurável via env", () => {
  const source = readFileSync(resolve(root, "lib/data/supabase-rest.mjs"), "utf8");
  assert.match(source, /DATA_REST_PAGE_SIZE/);
  assert.match(source, /TABLE_PAGE_SIZES/);
});
