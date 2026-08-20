-- Relatórios publicados pelo time de Inteligência (schema analytics).
-- Destino: projeto Auth/Business Data (AUTH_SUPABASE_URL).
-- NÃO executar na BASE QV.
-- Idempotente. Bucket privado analytics-reports.
--
-- Arquitetura:
--   Supabase Storage → binário do arquivo
--   analytics.reports → metadados
--
-- Rollback de upload: se INSERT falhar após upload, a API tenta DELETE no Storage.
-- Arquivos órfãos remanescentes exigem limpeza manual eventual.

-- ---------------------------------------------------------------------------
-- Tabela de metadados
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_extension text,
  file_size_bytes bigint,
  responsible_email text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'published',
  CONSTRAINT reports_title_not_blank CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT reports_status_published CHECK (status = 'published')
);

CREATE INDEX IF NOT EXISTS reports_created_at_desc_idx
  ON analytics.reports (created_at DESC);

CREATE INDEX IF NOT EXISTS reports_responsible_email_idx
  ON analytics.reports (responsible_email);

COMMENT ON TABLE analytics.reports IS
  'Metadados de relatórios publicados internamente. Binários ficam em Storage (bucket analytics-reports).';

-- ---------------------------------------------------------------------------
-- Grants (authenticated only; anon sem acesso)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Storage bucket privado
-- ---------------------------------------------------------------------------
-- Aplicar no Dashboard ou via SQL abaixo (storage schema).
-- Bucket: analytics-reports | public: false

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'analytics-reports',
  'analytics-reports',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Storage RLS — bucket analytics-reports apenas
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS analytics_reports_authenticated_select ON storage.objects;
CREATE POLICY analytics_reports_authenticated_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'analytics-reports');

DROP POLICY IF EXISTS analytics_reports_authenticated_insert ON storage.objects;
CREATE POLICY analytics_reports_authenticated_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'analytics-reports');

DROP POLICY IF EXISTS analytics_reports_authenticated_delete ON storage.objects;
CREATE POLICY analytics_reports_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'analytics-reports');

-- Paths sugeridos pela API:
--   reports/YYYY/MM/<uuid>_<safe_filename>
--
-- Signed URLs: geradas server-side via POST /storage/v1/object/sign/analytics-reports/...
