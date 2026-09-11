-- Mutação atômica de acesso via RPC em public.
-- Motivo: schema analytics NÃO está na Data API (PGRST106).
-- Destino: Business Data / Auth (rckpuebaiswrxzmywllv).
-- NÃO executar na BASE QV.
-- Exige 012 + 013. Não altera metric_catalog, metric_snapshot, reports, indicacoes.

DO $$
BEGIN
  IF to_regclass('analytics.dashboard_users') IS NULL THEN
    RAISE EXCEPTION 'analytics.dashboard_users não existe. Aplique 012 primeiro.';
  END IF;
  IF to_regprocedure('public.current_dashboard_access()') IS NULL THEN
    RAISE EXCEPTION 'public.current_dashboard_access() não existe. Aplique 013 primeiro.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION analytics.dashboard_user_payload(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'display_name', u.display_name,
    'is_owner', u.is_owner,
    'is_active', u.is_active,
    'created_at', u.created_at,
    'updated_at', u.updated_at,
    'created_by', u.created_by,
    'updated_by', u.updated_by,
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'name', g.name) ORDER BY g.code)
      FROM analytics.dashboard_user_groups ug
      JOIN analytics.dashboard_access_groups g ON g.id = ug.group_id
      WHERE ug.user_id = u.id AND g.is_active = true
    ), '[]'::jsonb)
  )
  FROM analytics.dashboard_users u
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION analytics.dashboard_user_payload(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_dashboard_access(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_actor text;
  v_email text;
  v_name text;
  v_owner boolean;
  v_active boolean;
  v_mode text;
  v_groups text[];
  v_unknown text;
  v_user analytics.dashboard_users%ROWTYPE;
  v_audit jsonb;
BEGIN
  IF NOT analytics.is_dashboard_owner() THEN
    RAISE EXCEPTION 'Somente Owners podem gerenciar acessos.' USING ERRCODE = '42501';
  END IF;

  v_actor := analytics.current_access_email();
  v_email := lower(btrim(coalesce(payload->>'email', '')));
  v_name := nullif(btrim(coalesce(payload->>'display_name', payload->>'displayName', '')), '');
  v_owner := coalesce((payload->>'is_owner')::boolean, (payload->>'isOwner')::boolean, false);
  v_active := coalesce((payload->>'is_active')::boolean, (payload->>'isActive')::boolean, true);
  v_mode := lower(btrim(coalesce(payload->>'mode', 'upsert')));

  SELECT coalesce(array_agg(DISTINCT lower(btrim(value))), '{}')
  INTO v_groups
  FROM jsonb_array_elements_text(coalesce(payload->'groups', '[]'::jsonb)) AS value
  WHERE lower(btrim(value)) <> '';

  IF v_email = '' OR split_part(v_email, '@', 2) IS DISTINCT FROM 'quartavia.com.br' THEN
    RAISE EXCEPTION 'Informe um e-mail @quartavia.com.br válido.' USING ERRCODE = '22023';
  END IF;

  SELECT c.code
  INTO v_unknown
  FROM unnest(v_groups) AS c(code)
  WHERE c.code NOT IN ('leaders', 'eps', 'team_leaders_ep', 'quality', 'finance')
  LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Grupo inválido: %', v_unknown USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM analytics.dashboard_users u WHERE u.email = v_email;

  IF v_mode = 'create' AND FOUND THEN
    RAISE EXCEPTION 'Este email já possui acesso.' USING ERRCODE = '23505';
  END IF;
  IF v_mode = 'update' AND NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO analytics.dashboard_users (email, display_name, is_owner, is_active, created_by, updated_by)
    VALUES (v_email, v_name, v_owner, v_active, v_actor, v_actor)
    RETURNING * INTO v_user;
  ELSE
    UPDATE analytics.dashboard_users
    SET display_name = v_name,
        is_owner = v_owner,
        is_active = v_active,
        updated_by = v_actor
    WHERE id = v_user.id
    RETURNING * INTO v_user;
  END IF;

  DELETE FROM analytics.dashboard_user_groups WHERE user_id = v_user.id;
  INSERT INTO analytics.dashboard_user_groups (user_id, group_id, created_by)
  SELECT v_user.id, g.id, v_actor
  FROM analytics.dashboard_access_groups g
  WHERE g.code = ANY (v_groups) AND g.is_active = true;

  FOR v_audit IN SELECT value FROM jsonb_array_elements(coalesce(payload->'audits', '[]'::jsonb))
  LOOP
    INSERT INTO analytics.dashboard_access_audit (
      target_user_id, target_email, action, old_value, new_value, changed_by
    ) VALUES (
      v_user.id,
      v_email,
      coalesce(v_audit->>'action', 'USER_UPDATED'),
      v_audit->'old_value',
      v_audit->'new_value',
      v_actor
    );
  END LOOP;

  RETURN analytics.dashboard_user_payload(v_user.id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_dashboard_access(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_dashboard_access(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_dashboard_access(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, public, pg_temp
AS $$
DECLARE
  v_actor text;
  v_email text;
  v_user analytics.dashboard_users%ROWTYPE;
  v_audit jsonb;
BEGIN
  IF NOT analytics.is_dashboard_owner() THEN
    RAISE EXCEPTION 'Somente Owners podem gerenciar acessos.' USING ERRCODE = '42501';
  END IF;

  v_actor := analytics.current_access_email();
  v_email := lower(btrim(coalesce(payload->>'email', '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM analytics.dashboard_users u WHERE u.email = v_email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  FOR v_audit IN SELECT value FROM jsonb_array_elements(coalesce(payload->'audits', '[]'::jsonb))
  LOOP
    INSERT INTO analytics.dashboard_access_audit (
      target_user_id, target_email, action, old_value, new_value, changed_by
    ) VALUES (
      v_user.id,
      v_email,
      coalesce(v_audit->>'action', 'USER_DELETED'),
      v_audit->'old_value',
      v_audit->'new_value',
      v_actor
    );
  END LOOP;

  DELETE FROM analytics.dashboard_users WHERE id = v_user.id;

  RETURN jsonb_build_object('email', v_email, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_dashboard_access(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_dashboard_access(jsonb) TO authenticated;
