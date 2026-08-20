import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_STATUS_FILTER,
  defaultGeneralFilters,
  filterGeneralClients,
} from "../../lib/analytics/general-filters.mjs";

const clients = [
  { clientId: "1", clientName: "Ana", clientCode: "A1", analyticalStatus: "Ativo", segmentLabel: "PRIVATE", engineer: "EP1", stayRange: "De 7 a 12 meses", contractDate: "2024-01-01", cancellationDate: null, program: "Pharus" },
  { clientId: "2", clientName: "Bruno", clientCode: "B2", analyticalStatus: "Congelado", segmentLabel: "OVER", engineer: "EP2", stayRange: "Até 3 meses", contractDate: "2025-01-01", cancellationDate: null, program: "Davos" },
  { clientId: "3", clientName: "Carla", clientCode: "C3", analyticalStatus: "Cancelado", segmentLabel: "PRIVATE", engineer: "EP1", stayRange: "De 13 a 24 meses", contractDate: "2022-01-01", cancellationDate: "2024-06-01", program: "Pharus" },
];

test("default Status = Ativo", () => {
  const filters = defaultGeneralFilters();
  assert.equal(filters.status, "active");
  assert.equal(DEFAULT_STATUS_FILTER, "active");
  const rows = filterGeneralClients(clients, filters);
  assert.deepEqual(rows.map((r) => r.clientId), ["1"]);
});

test("mudar status altera o dataset exibido", () => {
  const active = filterGeneralClients(clients, { ...defaultGeneralFilters(), status: "active" });
  const frozen = filterGeneralClients(clients, { ...defaultGeneralFilters(), status: "frozen" });
  const all = filterGeneralClients(clients, { ...defaultGeneralFilters(), status: "all" });
  const cancelled = filterGeneralClients(clients, { ...defaultGeneralFilters(), status: "cancelled" });
  assert.equal(active.length, 1);
  assert.equal(frozen.length, 1);
  assert.equal(cancelled.length, 1);
  assert.equal(all.length, 3);
});

test("limpar filtros volta para Ativos, não para Todos", () => {
  const dirty = { search: "carla", status: "all", segment: "PRIVATE", engineer: "EP1", program: "Pharus", contract: "last12", cancel: "none", stay: "all" };
  const cleared = defaultGeneralFilters();
  assert.equal(cleared.status, "active");
  assert.equal(cleared.search, "");
  assert.equal(cleared.segment, "all");
  const rows = filterGeneralClients(clients, cleared);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].analyticalStatus, "Ativo");
  assert.notEqual(dirty.status, cleared.status);
});
