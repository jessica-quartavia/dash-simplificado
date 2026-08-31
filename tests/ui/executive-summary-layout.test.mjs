import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { renderExecutiveDashboard } from "../../js/executive-summary-layout.mjs";

const root = resolve(import.meta.dirname, "../..");

const mockPayload = {
  baseClients: {
    status: "ok",
    metrics: {
      active_clients: { value: 1766 },
      frozen_clients: { value: 12 },
      median_stay_days: { value: 420, coverage: { percent: 99.8 } },
      active_segment_distribution: {
        value: [{ label: "APEX", count: 10, percent: 50 }, { label: "PRIVATE", count: 10, percent: 50 }],
      },
      median_monthly_income: { value: 40000, coverage: { percent: 91.9 } },
      median_last_contribution: { value: 5000, coverage: { percent: 88 } },
      median_liquidity_reserve: { value: 165651, coverage: { percent: 85 } },
      acquisition_last_3_months: {
        value: [
          { month: "2025-12", acquiredClients: 3 },
          { month: "2026-01", acquiredClients: 5 },
          { month: "2026-02", acquiredClients: 4 },
        ],
      },
    },
  },
  onboarding: {
    status: "ok",
    metrics: {
      onboarding_completion_rate: { value: 93.9, numerator: 100, denominator: 106 },
      median_first_meeting_days: { value: 9, coverage: { percent: 95 } },
    },
  },
  engagement: {
    status: "ok",
    metrics: {
      clients_without_meeting: { value: 10 },
      average_interval_between_meetings: { value: 45, calculation: "mean", median: 40 },
      days_to_first_meeting: { value: 9 },
      days_financial_to_activation: { value: 12 },
      days_to_central_intelligence: { value: 20 },
      clients_without_financial_diagnosis: { value: 5, rule: "total − com diagnóstico" },
    },
  },
  valueDelivery: {
    status: "ok",
    metrics: {
      clients_with_implemented_mechanisms: { value: 100 },
      clients_implementation_rate: { value: 55, numerator: 100, denominator: 180 },
      mechanism_type_distribution: { value: { top: [{ label: "M1", count: 10, percent: 50 }] } },
    },
  },
  clientHealth: {
    status: "partial",
    metrics: {
      nps: { value: 72, coverage: { percent: 80 } },
      promoters_detractors_share: {
        value: {
          promoters: { percent: 60 },
          detractors: { percent: 10 },
          neutrals: { percent: 30 },
        },
      },
      csat_average: { value: 4.8, coverage: { responses: 120 } },
      cancellation_intention_vs_effective: { value: [{ month: "2026-01", effective: 2, intentions: 5 }] },
      top_cancellation_reasons: { value: [{ label: "Financeiro", count: 3, percent: 40 }], note: "Motivos não categorizados excluídos." },
      intention_destination_branches: {
        value: {
          total: 20,
          branches: [
            { label: "Em processo", count: 5, percent: 25, subtitle: "Sem desfecho posterior" },
            { label: "Retido", count: 3, percent: 15, subtitle: "Desfecho de retenção" },
            { label: "Arquivado", count: 2, percent: 10, subtitle: "Possui registro arquivado" },
            { label: "Cancelado", count: 10, percent: 50, subtitle: "Cancelamento efetivado" },
          ],
        },
      },
      renewed_active_clients_rate: {
        value: 8.8,
        numerator: 150,
        denominator: 1700,
        rule: "clientes ativos com ciclo ≥ 2 ÷ clientes analiticamente ativos",
      },
    },
  },
  ep: {
    status: "ok",
    metrics: {
      top_ep_renewed_share: {
        value: {
          minSample: 10,
          high: { engineer: "EP1", percent: 55, renewed: 11, base: 20 },
          low: { engineer: "EP2", percent: 20, renewed: 3, base: 15 },
        },
      },
      top_ep_implementation_share: {
        value: {
          minSample: 10,
          high: { engineer: "EP2", percent: 66.7, implementedClients: 10, base: 15 },
          low: { engineer: "EP1", percent: 60, implementedClients: 12, base: 20 },
        },
      },
    },
  },
  temporal: {
    status: "ok",
    metrics: {
      temporal_top_signals: { value: [{ label: "Muitos dias desde a última reunião", count: 2, percent: 40 }] },
      temporal_signal_distribution: { value: [{ label: "1 sinal de atrito", count: 10, percent: 50 }] },
    },
  },
};

test("executive dashboard usa estrutura compacta sem mega-cards", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-dashboard/);
  assert.match(html, /executive-section/);
  assert.doesNotMatch(html, /exec-block/);
  assert.doesNotMatch(html, /kpi-grid exec-kpi-grid/);
});

test("Base usa grid de KPIs e mini-cards financeiros", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-grid--headline/);
  assert.match(html, /executive-grid--base-secondary/);
  assert.match(html, /executive-grid--mini-kpis/);
  assert.match(html, /executive-kpi--accent/);
  assert.match(html, /Aquisição — últimos 3 meses/);
});

test("Engajamento usa grid 3x2 compacto", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-grid--6/);
  assert.match(html, /executive-mini-kpi/);
  assert.match(html, /Clientes sem reunião/);
});

test("Entrega de valor divide KPIs e distribuição", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-grid--value/);
  assert.match(html, /executive-chart-card--distribution/);
});

test("Saúde subdivide NPS, split bar, cancelamentos e renovação", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-grid--health-top/);
  assert.match(html, /executive-split-bar/);
  assert.match(html, /executive-grid--health-bottom/);
  assert.match(html, /Renovações por clientes ativos/);
  assert.match(html, /8,8%/);
  assert.match(html, /150 clientes ativos renovados de 1\.700 ativos/);
  assert.doesNotMatch(html, /Clientes aptos para renovação/);
  assert.doesNotMatch(html, /Quantidade de renovações/);
});

test("EP usa ranking compacto com maior e menor", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-ep-rank/);
  assert.match(html, /executive-grid--ep/);
  assert.match(html, /Renovação/);
  assert.match(html, /Implementação/);
  assert.match(html, />Maior</);
  assert.match(html, />Menor</);
});

test("Congelados referencia base total e destino das intenções renderiza", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /Sobre a carteira total/);
  assert.match(html, /Destino das intenções e pedidos/);
  assert.match(html, /executive-intention-flow/);
  assert.match(html, /Soma das quatro ramificações/);
});

test("Motivos e atritos usam leitura executiva", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /Principais motivos de cancelamento/);
  assert.match(html, /ranked-bar-list/);
  assert.match(html, /executive-signal-ranked/);
  assert.match(html, /Atritos na jornada do cliente/);
  assert.match(html, /Sinais de atrito na jornada do cliente/);
  assert.match(html, /Clientes por quantidade de sinais de atrito/);
});

test("Temporal usa duas colunas", () => {
  const html = renderExecutiveDashboard(mockPayload);
  assert.match(html, /executive-grid--temporal/);
});

test("NPS sem dado renderiza card estável", () => {
  const payload = {
    ...mockPayload,
    clientHealth: {
      ...mockPayload.clientHealth,
      metrics: {
        ...mockPayload.clientHealth.metrics,
        nps: { value: null, coverage: { responses: 0 } },
      },
    },
  };
  const html = renderExecutiveDashboard(payload);
  assert.match(html, />NPS</);
  assert.match(html, /Sem dados/);
});

test("layout responsivo declara breakpoints mobile", () => {
  const css = readFileSync(resolve(root, "css/components.css"), "utf8");
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /executive-grid--headline[\s\S]*grid-template-columns: 1fr/);
});
