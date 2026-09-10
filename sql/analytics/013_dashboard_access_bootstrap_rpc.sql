-- Bootstrap de leitura do controle de acesso via RPC em public.
-- Motivo: o schema analytics NÃO está na Data API (PGRST106).
-- Destino: Business Data / Auth (rckpuebaiswrxzmywllv).
-- NÃO executar na BASE QV.
-- Exige que 012_dashboard_access.sql já tenha sido aplicado.
--
-- Esta função permite o login (GET current access) sem expor o schema
-- analytics inteiro. Management continua preferindo REST em analytics
-- depois que o schema for incluído em Settings → API → Exposed schemas.

DO $$
BEGIN
  IF to_regclass('analytics.dashboard_users') IS NULL THEN
    RAISE EXCEPTION 'analytics.dashboard_users não existe. Aplique sql/analytics/012_dashboard_access.sql primeiro.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.current_dashboard_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_email text;
  v_user analytics.dashboard_users%ROWTYPE;
  v_groups jsonb;
BEGIN
  v_email := lower(btrim(coalesce((SELECT auth.jwt() ->> 'email'), '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_user
  FROM analytics.dashboard_users u
  WHERE u.email = v_email;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name)
      ORDER BY g.code
    ),
    '[]'::jsonb
  )
  INTO v_groups
  FROM analytics.dashboard_user_groups ug
  JOIN analytics.dashboard_access_groups g ON g.id = ug.group_id
  WHERE ug.user_id = v_user.id
    AND g.is_active = true;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'display_name', v_user.display_name,
    'is_owner', v_user.is_owner,
    'is_active', v_user.is_active,
    'created_at', v_user.created_at,
    'updated_at', v_user.updated_at,
    'created_by', v_user.created_by,
    'updated_by', v_user.updated_by,
    'groups', v_groups
  );
END;
$$;

REVOKE ALL ON FUNCTION public.current_dashboard_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_dashboard_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_dashboard_access_users()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_email text;
  v_is_owner boolean;
BEGIN
  v_email := lower(btrim(coalesce((SELECT auth.jwt() ->> 'email'), '')));
  SELECT EXISTS (
    SELECT 1
    FROM analytics.dashboard_users u
    WHERE u.email = v_email
      AND u.is_owner = true
      AND u.is_active = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Somente Owners podem listar acessos.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.email)
    FROM (
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.is_owner,
        u.is_active,
        u.created_at,
        u.updated_at,
        u.created_by,
        u.updated_by,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name) ORDER BY g.code)
          FROM analytics.dashboard_user_groups ug
          JOIN analytics.dashboard_access_groups g ON g.id = ug.group_id
          WHERE ug.user_id = u.id AND g.is_active = true
        ), '[]'::jsonb) AS groups
      FROM analytics.dashboard_users u
    ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_dashboard_access_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_dashboard_access_users() TO authenticated;
