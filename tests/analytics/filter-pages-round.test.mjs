import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  defaultSatisfactionFilters,
  filterSatisfactionClients,
  npsClassificationFromScore,
  scoreInLastNpsBand,
} from "../../lib/analytics/satisfaction-filters.mjs";
import {
  CANCELLATION_STAGE_FILTER_OPTIONS,
  defaultCancellationFilters,
  filterCancellationClients,
  matchesCancellationStage,
  NO_RESPONSIBLE_LABEL,
} from "../../lib/analytics/cancellations-filters.mjs";
import {
  defaultEpPerformanceFilters,
  filterEpEngineers,
} from "../../lib/analytics/ep-performance-filters.mjs";
import {
  closeOpenDropdown,
  getOpenDropdown,
  registerOpenDropdown,
  unregisterOpenDropdown,
} from "../../js/components/dropdown-coordinator.js";
import { eventPathIncludes } from "../../js/components/overlay-root.js";
import { isMultiselectInsideEvent } from "../../js/components/filters/multi-select-filter.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SAT_ROWS = [
  {
    clientId: "1",
    clientName: "Ana",
    engineer: "EP1",
    program: "Pharus",
    latestNps: 9,
    csatResponses: 2,
  },
  {
    clientId: "2",
    clientName: "João",
    engineer: "EP2",
    program: "Davos",
    latestNps: 4,
    csatResponses: 0,
  },
  {
    clientId: "3",
    clientName: "Maria",
    engineer: "EP1",
    program: "Pharus",
    latestNps: 8,
    csatResponses: 1,
  },
];

const CANCEL_ROWS = [
  {
    clientId: "1",
    hasIntencao: true,
    hasPedido: false,
    hasIntentionOrPedido: true,
    hasEfetivado: false,
    reasonCategory: "Financeiro",
    responsavel: "Ana CS",
  },
  {
    clientId: "2",
    hasIntencao: false,
    hasPedido: true,
    hasIntentionOrPedido: true,
    hasEfetivado: false,
    reasonCategory: "Produto",
    responsavel: "Não informado",
  },
  {
    clientId: "3",
    hasIntencao: true,
    hasPedido: true,
    hasIntentionOrPedido: true,
    hasEfetivado: true,
    reasonCategory: "Financeiro",
    responsavel: "Bob CS",
  },
];

test("multiselect coordinator fecha instância anterior", () => {
  const calls = [];
  registerOpenDropdown({ close: () => calls.push("a") });
  registerOpenDropdown({ close: () => calls.push("b") });
  assert.deepEqual(calls, ["a"]);
  closeOpenDropdown();
  assert.equal(getOpenDropdown(), null);
  unregisterOpenDropdown({ close: () => {} });
});

test("multiselect source usa pointerdown capture e coordinator", () => {
  const source = readFileSync(resolve(root, "js/components/filters/multi-select-filter.js"), "utf8");
  assert.match(source, /pointerdown.*onPointerDown.*true/s);
  assert.match(source, /registerOpenDropdown/);
  assert.match(source, /unregisterOpenDropdown/);
  const applyBlock = source.match(/const applySelection = \(nextValues[\s\S]*?};/);
  assert.ok(applyBlock, "applySelection block");
  assert.doesNotMatch(applyBlock[0], /closePopover/);
});

test("navigation fecha dropdown ao trocar página", () => {
  const source = readFileSync(resolve(root, "js/navigation.js"), "utf8");
  assert.match(source, /closeOpenDropdown/);
});

test("eventPathIncludes reconhece nós do portal", () => {
  const trigger = { contains: () => false };
  const popover = {};
  const event = { composedPath: () => [popover, trigger] };
  assert.equal(isMultiselectInsideEvent(event, { trigger, popover }), true);
  assert.equal(eventPathIncludes(event, [popover]), true);
});

test("satisfação — classificação NPS", () => {
  assert.equal(npsClassificationFromScore(10), "promotor");
  assert.equal(npsClassificationFromScore(7), "neutro");
  assert.equal(npsClassificationFromScore(3), "detrator");
  const filtered = filterSatisfactionClients(SAT_ROWS, {
    ...defaultSatisfactionFilters(),
    npsClassification: "detrator",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].clientId, "2");
});

test("satisfação — possui CSAT e último NPS AND", () => {
  const filtered = filterSatisfactionClients(SAT_ROWS, {
    ...defaultSatisfactionFilters(),
    hasCsat: "yes",
    lastNpsBand: "7-8",
    program: "Pharus",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].clientId, "3");
});

test("satisfação — faixas último NPS", () => {
  assert.equal(scoreInLastNpsBand(2, "0-2"), true);
  assert.equal(scoreInLastNpsBand(4, "3-4"), true);
  assert.equal(scoreInLastNpsBand(9, "9-10"), true);
});

test("cancelamento — etapas", () => {
  assert.equal(matchesCancellationStage(CANCEL_ROWS[0], "intencao"), true);
  assert.equal(matchesCancellationStage(CANCEL_ROWS[1], "pedido"), true);
  assert.equal(matchesCancellationStage(CANCEL_ROWS[2], "efetivado"), true);
  assert.equal(
    filterCancellationClients(CANCEL_ROWS, {
      ...defaultCancellationFilters(),
      cancellationStage: "intencao_pedido",
    }).length,
    3,
  );
});

test("cancelamento — categoria e responsável", () => {
  const byCategory = filterCancellationClients(CANCEL_ROWS, {
    ...defaultCancellationFilters(),
    reasonCategory: "Financeiro",
  });
  assert.equal(byCategory.length, 2);

  const byResponsible = filterCancellationClients(CANCEL_ROWS, {
    ...defaultCancellationFilters(),
    responsible: NO_RESPONSIBLE_LABEL,
  });
  assert.equal(byResponsible.length, 1);
  assert.equal(byResponsible[0].clientId, "2");
});

test("cancelamento — opções de etapa incluem efetivado", () => {
  assert.ok(CANCELLATION_STAGE_FILTER_OPTIONS.some((item) => item.value === "efetivado"));
});

test("EP performance — multiselect OR", () => {
  const engineers = [
    { engineer: "EP A", clients: [{ engineer: "EP A", segment: "PRIVATE", program: "Pharus" }] },
    { engineer: "EP B", clients: [{ engineer: "EP B", segment: "APEX", program: "Davos" }] },
    { engineer: "EP C", clients: [{ engineer: "EP C", segment: "PRIVATE", program: "Pharus" }] },
  ];
  const filtered = filterEpEngineers(engineers, {
    ...defaultEpPerformanceFilters(),
    engineer: ["EP A", "EP B"],
  });
  assert.equal(filtered.length, 2);
});

test("EP performance — Todos não recorta", () => {
  const engineers = [{ engineer: "EP A", clients: [] }];
  assert.equal(filterEpEngineers(engineers, defaultEpPerformanceFilters()).length, 1);
});
