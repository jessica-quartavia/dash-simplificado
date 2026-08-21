-- Permite exclusão de relatórios pelo autor (Auth/Business Data).
-- NÃO executar na BASE QV. Idempotente.
-- Aplicar manualmente no projeto Auth/Business Data.

GRANT DELETE ON TABLE analytics.reports TO authenticated;

DROP POLICY IF EXISTS reports_authenticated_delete ON analytics.reports;
CREATE POLICY reports_authenticated_delete
  ON analytics.reports
  FOR DELETE
  TO authenticated
  USING (
    status = 'published'
    AND created_by = auth.uid()
  );

-- Storage: reforça DELETE apenas no bucket analytics-reports (006 já cria policy ampla).
DROP POLICY IF EXISTS analytics_reports_authenticated_delete_owned ON storage.objects;
CREATE POLICY analytics_reports_authenticated_delete_owned
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'analytics-reports'
    AND (storage.foldername(name))[1] = 'reports'
  );
