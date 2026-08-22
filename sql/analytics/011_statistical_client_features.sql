-- Snapshot derivado — features por cliente (Análises Estatísticas V2)
-- Destino: Business Data / Auth (AUTH_SUPABASE_URL) — schema analytics.
-- NÃO executar na BASE QV (lacinxsvjdwalkchxyeo).
-- NÃO executar automaticamente. Aplicar manualmente no Business Data.
--
-- Pré-requisito: sql/analytics/004_authenticated_access.sql (schema analytics + role authenticated).
-- Auth: apikey=AUTH_SUPABASE_ANON_KEY + Authorization=Bearer <JWT> → role authenticated + RLS.
-- Sem service role. Sem escrita para anon.

CREATE TABLE IF NOT EXISTS analytics.statistical_snapshot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_version text NOT NULL UNIQUE,
  calculation_version text NOT NULL,
  client_count integer NOT NULL DEFAULT 0,
  feature_count integer NOT NULL DEFAULT 0,
  source_row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  rest_requests integer,
  rest_rows integer,
  nps_join jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_generated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'building',
  is_active boolean NOT NULL DEFAULT false,
  CONSTRAINT statistical_snapshot_runs_status_chk CHECK (
    status IN ('building', 'complete', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS statistical_snapshot_runs_active_idx
  ON analytics.statistical_snapshot_runs (is_active, snapshot_generated_at DESC);

COMMENT ON TABLE analytics.statistical_snapshot_runs IS
  'Metadados de execuções do snapshot statistical_client_features. Uma versão ativa por vez.';

CREATE TABLE IF NOT EXISTS analytics.statistical_client_features (
  snapshot_version text NOT NULL REFERENCES analytics.statistical_snapshot_runs(snapshot_version) ON DELETE CASCADE,
  client_id text NOT NULL,
  features jsonb NOT NULL,
  -- Colunas denormalizadas para busca/filtros (PII mínima)
  client_code text,
  client_name text,
  analytical_status text,
  program text,
  engineer text,
  segment text,
  hire_date timestamptz,
  cancellation_date timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  is_cancelled boolean NOT NULL DEFAULT false,
  is_frozen boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_version, client_id)
);

CREATE INDEX IF NOT EXISTS statistical_client_features_active_lookup_idx
  ON analytics.statistical_client_features (snapshot_version, client_id);

CREATE INDEX IF NOT EXISTS statistical_client_features_search_idx
  ON analytics.statistical_client_features (snapshot_version, client_code, client_name);

COMMENT ON TABLE analytics.statistical_client_features IS
  'Features analíticas derivadas por cliente (sem raw payloads BASE QV). JSON features = registry oficial.';

COMMENT ON COLUMN analytics.statistical_client_features.features IS
  'Subset validado por STATISTICAL_FEATURE_REGISTRY — não inclui raw_payload.';

ALTER TABLE analytics.statistical_snapshot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.statistical_client_features ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analytics.statistical_snapshot_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE analytics.statistical_client_features FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE analytics.statistical_snapshot_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.statistical_client_features TO authenticated;

DROP POLICY IF EXISTS statistical_snapshot_runs_authenticated_read ON analytics.statistical_snapshot_runs;
CREATE POLICY statistical_snapshot_runs_authenticated_read
  ON analytics.statistical_snapshot_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS statistical_snapshot_runs_authenticated_insert ON analytics.statistical_snapshot_runs;
CREATE POLICY statistical_snapshot_runs_authenticated_insert
  ON analytics.statistical_snapshot_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS statistical_snapshot_runs_authenticated_update ON analytics.statistical_snapshot_runs;
CREATE POLICY statistical_snapshot_runs_authenticated_update
  ON analytics.statistical_snapshot_runs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS statistical_client_features_authenticated_read ON analytics.statistical_client_features;
CREATE POLICY statistical_client_features_authenticated_read
  ON analytics.statistical_client_features
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS statistical_client_features_authenticated_insert ON analytics.statistical_client_features;
CREATE POLICY statistical_client_features_authenticated_insert
  ON analytics.statistical_client_features
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS statistical_client_features_authenticated_update ON analytics.statistical_client_features;
CREATE POLICY statistical_client_features_authenticated_update
  ON analytics.statistical_client_features
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sem DELETE para authenticated (refresh versionado — upsert + ativar run).
-- Sem GRANT para anon. Sem service_role nestas tabelas.

-- Verificação manual (após aplicar):
-- SELECT COUNT(*) FROM analytics.statistical_snapshot_runs;
-- SELECT COUNT(*) FROM analytics.statistical_client_features WHERE snapshot_version = '<versão>';
