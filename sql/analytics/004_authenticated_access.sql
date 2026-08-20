-- Acesso autenticado ao schema analytics (Auth = Business Data).
-- Destino: o mesmo projeto de AUTH_SUPABASE_URL.
-- NÃO executar na BASE QV.
-- Idempotente. Não concede mutação ao papel anon.
--
-- Sem DELETE. Sem mutação para anon.
-- JWT: este projeto não decodifica claims no app. O PostgREST usa `role`
-- (anon vs authenticated). O e-mail corporativo é validado no endpoint
-- Vercel via /auth/v1/user, não no RLS, para não inventar claim.

GRANT USAGE ON SCHEMA analytics TO authenticated;
REVOKE ALL ON SCHEMA analytics FROM anon;

REVOKE ALL ON TABLE analytics.metric_catalog FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE analytics.metric_catalog TO authenticated;

REVOKE ALL ON TABLE analytics.metric_snapshot FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.metric_snapshot TO authenticated;

ALTER TABLE analytics.metric_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.metric_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metric_catalog_authenticated_read ON analytics.metric_catalog;
CREATE POLICY metric_catalog_authenticated_read
  ON analytics.metric_catalog
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS metric_snapshot_authenticated_read ON analytics.metric_snapshot;
CREATE POLICY metric_snapshot_authenticated_read
  ON analytics.metric_snapshot
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS metric_snapshot_authenticated_insert ON analytics.metric_snapshot;
CREATE POLICY metric_snapshot_authenticated_insert
  ON analytics.metric_snapshot
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS metric_snapshot_authenticated_update ON analytics.metric_snapshot;
CREATE POLICY metric_snapshot_authenticated_update
  ON analytics.metric_snapshot
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
