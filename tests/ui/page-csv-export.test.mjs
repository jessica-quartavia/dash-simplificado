import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSV_SEPARATOR,
  escapeCsv,
  formatCsvValue,
  formatExtractedAt,
  normalizeFilename,
  sectionsToCsvText,
  buildMetadataSection,
  buildKpiSection,
} from "../../js/export-csv.js";
import { buildPageFilterMetadata } from "../../lib/analytics/page-csv-filters.mjs";
import {
  PAGE_EXPORT_BUILDERS,
  buildHealthScoreCsv,
  composePageCsvDownload,
} from "../../lib/analytics/page-csv-builders.mjs";
import {
  PAGE_CSV_EXPORT_IDS,
  CSV_EXPORT_EXCLUDED_PAGE_IDS,
  canExportPageCsv,
} from "../../js/page-export-registry.js";
import { setCurrentAccess, clearCurrentAccess } from "../../js/access-context.js";
import { canAccessPage } from "../../lib/access/access-policy.mjs";
import { renderPageActions } from "../../js/components/page-refresh.js";
import { DEFAULT_MECHANISM_SLIDER, weightsFromMechanismSlider } from "../../lib/analytics/health-score-metrics.mjs";

const ROOT = join(process.cwd());

test("PAGE_CSV_EXPORT_IDS cobre páginas analíticas solicitadas", () => {
  for (const id of [
    "executive_summary",
    "general",
    "journey",
    "meetings",
    "patrimonial_plan",
    "mechanisms",
    "platform_usage",
    "financial_updates",
    "satisfaction",
    "cancellations",
    "renewal",
    "ep_performance",
    "temporal_indicators",
    "statistical_crosses",
    "health_score",
    "quality",
    "support",
  ]) {
    assert.ok(PAGE_CSV_EXPORT_IDS.includes(id), id);
    assert.equal(typeof PAGE_EXPORT_BUILDERS[id], "function");
  }
});

test("páginas excluídas não exportam", () => {
  for (const id of CSV_EXPORT_EXCLUDED_PAGE_IDS) {
    assert.ok(!PAGE_CSV_EXPORT_IDS.includes(id));
  }
});

test("renderPageActions inclui Baixar CSV quando pageId exportável", () => {
  const html = renderPageActions({ pageId: "meetings", showCsv: true, csvEnabled: true, enabled: true });
  assert.match(html, /Baixar CSV/);
  assert.match(html, /btn-csv-export/);
});

test("metadata inclui filtros da página", () => {
  const rows = buildPageFilterMetadata("general", {
    search: "acme",
    status: "active",
    engineer: "all",
    program: "Kids",
    period: "custom",
    from: "2026-01-01",
    to: "2026-01-31",
  });
  assert.ok(rows.some((r) => r.label === "Busca" && r.value.includes("acme")));
  assert.ok(rows.some((r) => r.label === "Programa" && r.value === "Kids"));
});

test("normalizeFilename padrão analytics slug e data", () => {
  const name = normalizeFilename("reunioes", new Date("2026-09-22T15:00:00-03:00"));
  assert.match(name, /^analytics_reunioes_2026-09-22_\d{4}\.csv$/);
});

test("UTF-8 BOM e separador ;", () => {
  const text = sectionsToCsvText([buildKpiSection("KPIS", [{ metric: "NPS", value: "65,5%" }])], ";");
  assert.ok(text.startsWith("\uFEFF"));
  assert.ok(text.includes("metrica;valor"));
  assert.ok(text.includes("NPS;65,5%"));
  assert.equal(CSV_SEPARATOR, ";");
});

test("escapeCsv aspas e ponto-e-vírgula", () => {
  assert.equal(escapeCsv('a;"b"'), '"a;""b"""');
  assert.equal(escapeCsv("linha\n2"), '"linha\n2"');
});

test("formatCsvValue percentuais e datas", () => {
  assert.equal(formatCsvValue(65.5, { type: "percent" }), "65,5%");
  assert.equal(formatCsvValue("2026-09-22", { type: "date" }), "22/09/2026");
});

test("formatCsvValue rejeita undefined NaN e object", () => {
  assert.equal(formatCsvValue(undefined), "Não informado");
  assert.equal(formatCsvValue(Number.NaN), "");
  assert.equal(formatCsvValue({ a: 1 }), "");
});

test("Health Score export usa pesos do slider", () => {
  const slider = 0.35;
  const weights = weightsFromMechanismSlider(slider);
  const built = buildHealthScoreCsv({
    mechanismSlider: slider,
    filters: { status: "active_or_frozen", engineer: "all", program: "all", classification: "all", search: "" },
    payload: {
      clients: [
        { clientId: "1", clientName: "A", engineer: "EP", meetingCount: 2, hasMechanism: true, analyticalStatus: "Ativo" },
      ],
    },
  });
  const weightRow = built.filterRows.find((r) => r.label.includes("slider"));
  assert.ok(weightRow);
  assert.equal(String(weightRow.value), String(slider));
  const kpiSection = built.sections[0];
  const weightLine = kpiSection.find((row) => row[0] === "Peso reuniões / mecanismos (%)");
  assert.ok(weightLine);
  assert.match(String(weightLine[1]), /\//);
  assert.equal(weights.mechanism, weightsFromMechanismSlider(slider).mechanism);
});

test("canExportPageCsv respeita access policy (support owner-only)", () => {
  const ep = { isOwner: false, isActive: true, groups: ["eps"] };
  assert.equal(canAccessPage(ep, "support"), false);
  setCurrentAccess(ep);
  assert.equal(canExportPageCsv("support"), false);

  const owner = { isOwner: true, isActive: true, groups: [] };
  assert.equal(canAccessPage(owner, "support"), true);
  setCurrentAccess(owner);
  assert.equal(canExportPageCsv("support"), true);
  clearCurrentAccess();
});

test("composePageCsvDownload gera documento com metadados", () => {
  const { csv, filename } = composePageCsvDownload(
    "executive_summary",
    { payload: { baseClients: { metrics: {} } }, filters: { program: "all" } },
    new Date("2026-09-22T12:00:00Z"),
  );
  assert.match(filename, /^analytics_/);
  assert.match(csv, /# METADADOS/);
  assert.match(csv, /extraido_em/);
  assert.match(csv, /Resumo Executivo|executive/);
});

test("botão CSV wired nas páginas analíticas (createPageRefresh)", () => {
  const files = [
    "js/executive-summary.js",
    "js/general-data.js",
    "js/onboarding.js",
    "js/meetings.js",
    "js/health-score.js",
  ];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.match(src, /getExportContext:/, rel);
    assert.match(src, /pageId:/, rel);
  }
});

test("formatExtractedAt PT-BR", () => {
  const s = formatExtractedAt(new Date("2026-09-22T15:00:00-03:00"));
  assert.match(s, /22\/09\/2026/);
  assert.match(s, /15:00/);
});
