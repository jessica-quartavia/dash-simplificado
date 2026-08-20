-- Correção incremental de acesso a analytics.reports (Auth/Business Data).
-- Use quando a tabela já existe no Table Editor, mas GET /api/reports falha
-- com permission denied ou a tabela não aparece na Data API.
-- NÃO executar na BASE QV.
-- Idempotente. Não recria a tabela.

GRANT USAGE ON SCHEMA analytics TO authenticated;
REVOKE ALL ON SCHEMA analytics FROM anon;

REVOKE ALL ON TABLE analytics.reports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE analytics.reports TO authenticated;

ALTER TABLE analytics.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reports_authenticated_read ON analytics.reports;
CREATE POLICY reports_authenticated_read
  ON analytics.reports
  FOR SELECT
  TO authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS reports_authenticated_insert ON analytics.reports;
CREATE POLICY reports_authenticated_insert
  ON analytics.reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'published'
    AND responsible_email IS NOT NULL
    AND char_length(btrim(title)) > 0
  );

-- Se GET ainda retornar PGRST106 após grants:
-- Supabase Dashboard → Settings → API → Exposed schemas → incluir "analytics".
--
-- Se GET retornar PGRST205 com tabela existente:
-- aguarde reload do schema cache ou reinicie o PostgREST no projeto.
