-- Snapshot analítico V2
-- Destino: Business Data (rckpuebaiswrxzmywllv), schema analytics.
-- NÃO executar na BASE QV (lacinxsvjdwalkchxyeo).
--
-- Decisão de erro: um cálculo com status=error NÃO substitui o último
-- snapshot válido. O writer só faz UPSERT de ok/partial/unavailable.

CREATE TABLE IF NOT EXISTS analytics.metric_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id text NOT NULL REFERENCES analytics.metric_catalog(metric_id),
  page_id text NOT NULL,
  scope_key text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  value jsonb NOT NULL,
  numerator numeric,
  denominator numeric,
  coverage numeric,
  sample_size integer,
  calculation_status text NOT NULL DEFAULT 'ok',
  warning text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  calculation_version text,
  CONSTRAINT metric_snapshot_metric_scope_uidx UNIQUE (metric_id, scope_key),
  CONSTRAINT metric_snapshot_status_chk CHECK (
    calculation_status IN ('ok', 'partial', 'unavailable', 'error')
  )
);

CREATE INDEX IF NOT EXISTS metric_snapshot_page_id_idx
  ON analytics.metric_snapshot (page_id);

CREATE INDEX IF NOT EXISTS metric_snapshot_generated_at_idx
  ON analytics.metric_snapshot (generated_at DESC);

CREATE INDEX IF NOT EXISTS metric_snapshot_status_idx
  ON analytics.metric_snapshot (calculation_status);

COMMENT ON TABLE analytics.metric_snapshot IS
  'Valores agregados atuais das métricas validadas na V2. Sem PII. Sem valores inventados.';

ALTER TABLE analytics.metric_snapshot ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analytics.metric_snapshot FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA analytics TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.metric_snapshot TO service_role;
