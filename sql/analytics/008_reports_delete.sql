-- Permite exclusão de relatórios publicados (Auth/Business Data).
-- NÃO executar na BASE QV. Idempotente.

GRANT DELETE ON TABLE analytics.reports TO authenticated;

DROP POLICY IF EXISTS reports_authenticated_delete ON analytics.reports;
CREATE POLICY reports_authenticated_delete
  ON analytics.reports
  FOR DELETE
  TO authenticated
  USING (status = 'published');
