-- Grupo Produto + seed dos 5 usuários + allowlist do upsert.
-- Incremental. Não edita 012–015.
-- Destino: Business Data / Auth (rckpuebaiswrxzmywllv).
-- NÃO executar na BASE QV.
-- Preserva RLS, is_owner e demais usuários.

DO $$
BEGIN
  IF to_regclass('analytics.dashboard_users') IS NULL THEN
    RAISE EXCEPTION 'analytics.dashboard_users não existe. Aplique 012 primeiro.';
  END IF;
  IF to_regprocedure('public.upsert_dashboard_access(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'public.upsert_dashboard_access(jsonb) não existe. Aplique 015 primeiro.';
  END IF;
END
$$;

INSERT INTO analytics.dashboard_access_groups (code, name, description, is_active)
VALUES ('product', 'Produto', 'Herdam as permissões de Líderes.', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true;

WITH product_emails(email) AS (
  VALUES
    ('adrianocosta@quartavia.com.br'),
    ('barbaradias@quartavia.com.br'),
    ('brunaarnold@quartavia.com.br'),
    ('giselegodoy@quartavia.com.br'),
    ('lilianereus@quartavia.com.br')
),
upserted AS (
  INSERT INTO analytics.dashboard_users (email, is_active, is_owner, created_by, updated_by)
  SELECT e.email, true, false, 'seed:016_dashboard_access_product', 'seed:016_dashboard_access_product'
  FROM product_emails e
  ON CONFLICT (email) DO UPDATE
  SET is_active = true,
      updated_by = 'seed:016_dashboard_access_product',
      updated_at = now()
  RETURNING id
)
DELETE FROM analytics.dashboard_user_groups ug
USING upserted u
WHERE ug.user_id = u.id;

INSERT INTO analytics.dashboard_user_groups (user_id, group_id, created_by)
SELECT u.id, g.id, 'seed:016_dashboard_access_product'
FROM analytics.dashboard_users u
JOIN analytics.dashboard_access_groups g ON g.code = 'product' AND g.is_active = true
WHERE u.email IN (
  'adrianocosta@quartavia.com.br',
  'barbaradias@quartavia.com.br',
  'brunaarnold@quartavia.com.br',
  'giselegodoy@quartavia.com.br',
  'lilianereus@quartavia.com.br'
)
ON CONFLICT (user_id, group_id) DO NOTHING;

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
  WHERE c.code NOT IN ('leaders', 'eps', 'team_leaders_ep', 'quality', 'finance', 'product')
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
