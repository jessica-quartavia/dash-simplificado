-- Catálogo analítico V2
-- Destino: Business Data (projeto rckpuebaiswrxzmywllv), schema analytics.
-- NÃO executar na BASE QV (lacinxsvjdwalkchxyeo).
-- Depois de criar a tabela, exponha o schema `analytics` em Settings → API.

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.metric_catalog (
  metric_id text PRIMARY KEY,
  page_id text NOT NULL,
  page_label text NOT NULL,
  label text NOT NULL,
  description text,
  metric_type text,
  unit text,
  dash_kids_status text,
  validated_for_v2 boolean NOT NULL DEFAULT false,
  scope_policy text,
  population_description text,
  calculation_summary text,
  source_systems jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_objects jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ui_priority text,
  v1_reference text,
  csv_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metric_catalog_page_id_idx
  ON analytics.metric_catalog (page_id);

CREATE INDEX IF NOT EXISTS metric_catalog_validated_idx
  ON analytics.metric_catalog (validated_for_v2);

CREATE INDEX IF NOT EXISTS metric_catalog_dash_kids_idx
  ON analytics.metric_catalog (dash_kids_status);

COMMENT ON TABLE analytics.metric_catalog IS
  'Metadados e regras dos indicadores do Analytics V2. Não armazena valores dinâmicos.';

ALTER TABLE analytics.metric_catalog ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analytics.metric_catalog FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA analytics TO service_role;
GRANT SELECT ON TABLE analytics.metric_catalog TO service_role;
