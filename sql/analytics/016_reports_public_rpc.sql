-- Relatórios via RPC em public (schema analytics não está na Data API / PGRST106).
-- Destino: Business Data / Auth (rckpuebaiswrxzmywllv).
-- NÃO executar na BASE QV.
-- Preserva analytics.reports e RLS; não recria tabela.

DO $$
BEGIN
  IF to_regclass('analytics.reports') IS NULL THEN
    RAISE EXCEPTION 'analytics.reports não existe. Aplique sql/analytics/006_reports.sql primeiro.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.list_published_reports()
RETURNS SETOF analytics.reports
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = analytics, public, pg_temp
AS $$
  SELECT r.*
  FROM analytics.reports r
  WHERE r.status = 'published'
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_published_report(p_id uuid)
RETURNS analytics.reports
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = analytics, public, pg_temp
AS $$
  SELECT r.*
  FROM analytics.reports r
  WHERE r.id = p_id
    AND r.status = 'published'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.insert_published_report(
  p_title text,
  p_description text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_extension text,
  p_file_size_bytes bigint,
  p_responsible_email text,
  p_created_by uuid
)
RETURNS analytics.reports
LANGUAGE sql
SECURITY INVOKER
SET search_path = analytics, public, pg_temp
AS $$
  INSERT INTO analytics.reports (
    title,
    description,
    file_name,
    storage_path,
    mime_type,
    file_extension,
    file_size_bytes,
    responsible_email,
    created_by,
    status
  )
  VALUES (
    btrim(p_title),
    nullif(btrim(p_description), ''),
    p_file_name,
    p_storage_path,
    p_mime_type,
    p_file_extension,
    p_file_size_bytes,
    lower(btrim(p_responsible_email)),
    p_created_by,
    'published'
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.delete_published_report(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = analytics, public, pg_temp
AS $$
  DELETE FROM analytics.reports r
  WHERE r.id = p_id
    AND r.status = 'published';
$$;

REVOKE ALL ON FUNCTION public.list_published_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_published_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.insert_published_report(text, text, text, text, text, text, bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_published_report(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_published_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_published_report(text, text, text, text, text, text, bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_published_report(uuid) TO authenticated;
