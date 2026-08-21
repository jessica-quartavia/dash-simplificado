-- DELETE corporativo para Relatórios (Auth/Business Data).
-- NÃO executar automaticamente. Aplicar manualmente no projeto Auth/Business Data.
-- NÃO executar na BASE QV.
--
-- Regra desejada: qualquer usuário autenticado corporativo pode excluir
-- qualquer relatório publicado. anon continua sem DELETE.
--
-- Substitui ownership (009) e alinha tabela + Storage.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Tabela analytics.reports
-- ---------------------------------------------------------------------------

REVOKE DELETE ON TABLE analytics.reports FROM anon;
GRANT DELETE ON TABLE analytics.reports TO authenticated;

DROP POLICY IF EXISTS reports_authenticated_delete ON analytics.reports;
CREATE POLICY reports_authenticated_delete
  ON analytics.reports
  FOR DELETE
  TO authenticated
  USING (status = 'published');

-- ---------------------------------------------------------------------------
-- Storage bucket analytics-reports — DELETE authenticated only
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS analytics_reports_authenticated_delete_owned ON storage.objects;
DROP POLICY IF EXISTS analytics_reports_authenticated_delete ON storage.objects;
CREATE POLICY analytics_reports_authenticated_delete_corporate
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'analytics-reports'
    AND (storage.foldername(name))[1] = 'reports'
  );

-- Diagnóstico sugerido (read-only):
-- SELECT id, title, created_by, responsible_email, status, storage_path
-- FROM analytics.reports
-- ORDER BY created_at DESC;

-- Após aplicar, validar:
-- DELETE /api/reports?id=<uuid> → HTTP 200 + { ok: true, message: "Relatório excluído." }
