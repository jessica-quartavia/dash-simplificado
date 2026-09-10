-- Controle de acesso do Analytics V2
-- Destino: Business Data / Auth (project ref rckpuebaiswrxzmywllv), schema analytics.
-- NÃO executar na BASE QV (lacinxsvjdwalkchxyeo).
-- NÃO altera metric_catalog, metric_snapshot, reports, indicacoes.
-- Idempotente. Sem senha. Sem role único por usuário.
--
-- CONFIRMAR project ref no SQL Editor antes de executar:
--   select current_setting('request.jwt.claim.sub', true);
--   -- ou conferir a URL do projeto: https://rckpuebaiswrxzmywllv.supabase.co
-- Se o projeto não for rckpuebaiswrxzmywllv, NÃO executar.

CREATE SCHEMA IF NOT EXISTS analytics;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.dashboard_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text,
  is_owner boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  CONSTRAINT dashboard_users_email_normalized
    CHECK (email = lower(btrim(email)) AND position('@' in email) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_users_email_uidx
  ON analytics.dashboard_users (email);

CREATE INDEX IF NOT EXISTS dashboard_users_active_owner_idx
  ON analytics.dashboard_users (is_active, is_owner);

CREATE TABLE IF NOT EXISTS analytics.dashboard_access_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_access_groups_code_normalized
    CHECK (code = lower(btrim(code)))
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_access_groups_code_uidx
  ON analytics.dashboard_access_groups (code);

CREATE TABLE IF NOT EXISTS analytics.dashboard_user_groups (
  user_id uuid NOT NULL REFERENCES analytics.dashboard_users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES analytics.dashboard_access_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  PRIMARY KEY (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS dashboard_user_groups_group_idx
  ON analytics.dashboard_user_groups (group_id);

CREATE TABLE IF NOT EXISTS analytics.dashboard_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid REFERENCES analytics.dashboard_users(id) ON DELETE SET NULL,
  target_email text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboard_access_audit_target_idx
  ON analytics.dashboard_access_audit (target_email, changed_at DESC);

CREATE INDEX IF NOT EXISTS dashboard_access_audit_changed_at_idx
  ON analytics.dashboard_access_audit (changed_at DESC);

COMMENT ON TABLE analytics.dashboard_users IS
  'Usuários autorizados do Analytics V2. Login continua no Supabase Auth; esta tabela não armazena senha.';
COMMENT ON TABLE analytics.dashboard_access_groups IS
  'Times/perfis de acesso (líderes, EPs, team leaders, qualidade, financeiro).';
COMMENT ON TABLE analytics.dashboard_user_groups IS
  'Vínculo many-to-many: um usuário pode pertencer a vários times.';
COMMENT ON TABLE analytics.dashboard_access_audit IS
  'Auditoria de criação, grupos, owner e ativação/desativação.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.touch_dashboard_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = analytics, pg_temp
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_users_touch ON analytics.dashboard_users;
CREATE TRIGGER dashboard_users_touch
  BEFORE INSERT OR UPDATE ON analytics.dashboard_users
  FOR EACH ROW
  EXECUTE FUNCTION analytics.touch_dashboard_user();

-- ---------------------------------------------------------------------------
-- Helpers SECURITY DEFINER (sem recursão de policy; e-mail vem do JWT)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.current_access_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(coalesce((SELECT auth.jwt() ->> 'email'), '')));
$$;

CREATE OR REPLACE FUNCTION analytics.is_dashboard_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM analytics.dashboard_users u
    WHERE u.email = analytics.current_access_email()
      AND u.is_owner = true
      AND u.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION analytics.current_access_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION analytics.is_dashboard_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analytics.current_access_email() TO authenticated;
GRANT EXECUTE ON FUNCTION analytics.is_dashboard_owner() TO authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA analytics TO authenticated;
REVOKE ALL ON SCHEMA analytics FROM anon;

REVOKE ALL ON TABLE analytics.dashboard_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE analytics.dashboard_access_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE analytics.dashboard_user_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE analytics.dashboard_access_audit FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE analytics.dashboard_users TO authenticated;
GRANT SELECT ON TABLE analytics.dashboard_access_groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE analytics.dashboard_user_groups TO authenticated;
GRANT SELECT, INSERT ON TABLE analytics.dashboard_access_audit TO authenticated;

ALTER TABLE analytics.dashboard_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_access_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_access_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE analytics.dashboard_users FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_access_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_user_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics.dashboard_access_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_users_select_own_or_owner ON analytics.dashboard_users;
CREATE POLICY dashboard_users_select_own_or_owner
  ON analytics.dashboard_users
  FOR SELECT
  TO authenticated
  USING (
    email = (SELECT analytics.current_access_email())
    OR (SELECT analytics.is_dashboard_owner())
  );

DROP POLICY IF EXISTS dashboard_users_insert_owner ON analytics.dashboard_users;
CREATE POLICY dashboard_users_insert_owner
  ON analytics.dashboard_users
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT analytics.is_dashboard_owner()));

DROP POLICY IF EXISTS dashboard_users_update_owner ON analytics.dashboard_users;
CREATE POLICY dashboard_users_update_owner
  ON analytics.dashboard_users
  FOR UPDATE
  TO authenticated
  USING ((SELECT analytics.is_dashboard_owner()))
  WITH CHECK ((SELECT analytics.is_dashboard_owner()));

DROP POLICY IF EXISTS dashboard_groups_select_authenticated ON analytics.dashboard_access_groups;
CREATE POLICY dashboard_groups_select_authenticated
  ON analytics.dashboard_access_groups
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS dashboard_user_groups_select_own_or_owner ON analytics.dashboard_user_groups;
CREATE POLICY dashboard_user_groups_select_own_or_owner
  ON analytics.dashboard_user_groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM analytics.dashboard_users u
      WHERE u.id = user_id
        AND u.email = (SELECT analytics.current_access_email())
    )
    OR (SELECT analytics.is_dashboard_owner())
  );

DROP POLICY IF EXISTS dashboard_user_groups_insert_owner ON analytics.dashboard_user_groups;
CREATE POLICY dashboard_user_groups_insert_owner
  ON analytics.dashboard_user_groups
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT analytics.is_dashboard_owner()));

DROP POLICY IF EXISTS dashboard_user_groups_delete_owner ON analytics.dashboard_user_groups;
CREATE POLICY dashboard_user_groups_delete_owner
  ON analytics.dashboard_user_groups
  FOR DELETE
  TO authenticated
  USING ((SELECT analytics.is_dashboard_owner()));

DROP POLICY IF EXISTS dashboard_access_audit_select_owner ON analytics.dashboard_access_audit;
CREATE POLICY dashboard_access_audit_select_owner
  ON analytics.dashboard_access_audit
  FOR SELECT
  TO authenticated
  USING ((SELECT analytics.is_dashboard_owner()));

DROP POLICY IF EXISTS dashboard_access_audit_insert_owner ON analytics.dashboard_access_audit;
CREATE POLICY dashboard_access_audit_insert_owner
  ON analytics.dashboard_access_audit
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT analytics.is_dashboard_owner()));

-- ---------------------------------------------------------------------------
-- Seed grupos
-- ---------------------------------------------------------------------------

INSERT INTO analytics.dashboard_access_groups (code, name, description)
VALUES
  ('leaders', 'Líderes', 'Acesso amplo aos dashboards, exceto páginas em construção e gerenciamento.'),
  ('eps', 'EPs', 'Visão geral sem Relatórios e Jornada sem Uso da Plataforma.'),
  ('team_leaders_ep', 'Team Leaders EP', 'Herdam EPs e ganham Relatórios e Performance do EP.'),
  ('quality', 'Qualidade', 'Dados Gerais, Satisfação, Acionamentos, Cancelamento e Renovação.'),
  ('finance', 'Financeiro', 'Resumo Executivo, Dados Gerais, Cancelamento e Renovação.')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true;

-- ---------------------------------------------------------------------------
-- Seed usuários + vínculos (idempotente)
-- ---------------------------------------------------------------------------

WITH seed(email, is_owner, groups) AS (
  VALUES
    ('jessicacarvalho@quartavia.com.br', true, ARRAY[]::text[]),
    ('matheuslacerda@quartavia.com.br', true, ARRAY[]::text[]),
    ('thassyacosta@quartavia.com.br', true, ARRAY[]::text[]),
    ('cadubarral@quartavia.com.br', true, ARRAY['leaders']::text[]),
    ('anagazzo@quartavia.com.br', true, ARRAY['leaders']::text[]),
    ('victoriadalmeida@quartavia.com.br', false, ARRAY['leaders']::text[]),
    ('maximomarmund@quartavia.com.br', false, ARRAY['leaders', 'finance']::text[]),
    ('raphaelribas@quartavia.com.br', false, ARRAY['leaders']::text[]),
    ('adriancarvalho@quartavia.com.br', false, ARRAY['leaders']::text[]),
    ('victor@quartavia.com.br', false, ARRAY['leaders']::text[]),
    ('nicolasalves@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('rodrigoamorim@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('rodrigolunardi@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('samuelaraujo@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('talesrozo@quartavia.com.br', false, ARRAY['eps', 'team_leaders_ep']::text[]),
    ('thiagotrova@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('tiagojunior@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('willianschimidt@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('andrerockenbach@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('abnerbraga@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('williansobral@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('carlosserafin@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('cleuberaparecido@quartavia.com.br', false, ARRAY['eps', 'team_leaders_ep']::text[]),
    ('joaoaliceda@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('hendrickramos@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('juniorteixeira@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('lucasdaniel@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('pedrogoulart@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('felipealeixo@quartavia.com.br', false, ARRAY['eps', 'team_leaders_ep']::text[]),
    ('andrielicampesato@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('eduardoperoni@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('gabrieloliveira@quartavia.com.br', false, ARRAY['eps', 'team_leaders_ep']::text[]),
    ('gustavomariano@quartavia.com.br', false, ARRAY['eps', 'team_leaders_ep']::text[]),
    ('juliocienkonog@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('nelsonmarques@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('elenicesolovy@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('arielzocoli@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('danielfentanes@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('thiagofreire@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('anaavalos@quartavia.com.br', false, ARRAY['eps']::text[]),
    ('steffanydutra@quartavia.com.br', false, ARRAY['quality']::text[]),
    ('demervaljunior@quartavia.com.br', false, ARRAY['quality']::text[]),
    ('lizfidelis@quartavia.com.br', false, ARRAY['quality']::text[]),
    ('financeiro@quartavia.com.br', false, ARRAY['finance']::text[]),
    ('wilsoncohim@quartavia.com.br', false, ARRAY['finance']::text[]),
    ('gabrielcouto@quartavia.com.br', false, ARRAY['finance']::text[]),
    ('brennosherlock@quartavia.com.br', false, ARRAY['finance']::text[])
)
INSERT INTO analytics.dashboard_users (email, is_owner, is_active, created_by, updated_by)
SELECT lower(btrim(email)), is_owner, true, 'seed:012_dashboard_access', 'seed:012_dashboard_access'
FROM seed
ON CONFLICT (email) DO UPDATE
SET is_owner = analytics.dashboard_users.is_owner OR EXCLUDED.is_owner,
    is_active = true,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

INSERT INTO analytics.dashboard_user_groups (user_id, group_id, created_by)
SELECT u.id, g.id, 'seed:012_dashboard_access'
FROM (
  VALUES
    ('anagazzo@quartavia.com.br', 'leaders'),
    ('cadubarral@quartavia.com.br', 'leaders'),
    ('victoriadalmeida@quartavia.com.br', 'leaders'),
    ('maximomarmund@quartavia.com.br', 'leaders'),
    ('maximomarmund@quartavia.com.br', 'finance'),
    ('raphaelribas@quartavia.com.br', 'leaders'),
    ('adriancarvalho@quartavia.com.br', 'leaders'),
    ('victor@quartavia.com.br', 'leaders'),
    ('nicolasalves@quartavia.com.br', 'eps'),
    ('rodrigoamorim@quartavia.com.br', 'eps'),
    ('rodrigolunardi@quartavia.com.br', 'eps'),
    ('samuelaraujo@quartavia.com.br', 'eps'),
    ('talesrozo@quartavia.com.br', 'eps'),
    ('talesrozo@quartavia.com.br', 'team_leaders_ep'),
    ('thiagotrova@quartavia.com.br', 'eps'),
    ('tiagojunior@quartavia.com.br', 'eps'),
    ('willianschimidt@quartavia.com.br', 'eps'),
    ('andrerockenbach@quartavia.com.br', 'eps'),
    ('abnerbraga@quartavia.com.br', 'eps'),
    ('williansobral@quartavia.com.br', 'eps'),
    ('carlosserafin@quartavia.com.br', 'eps'),
    ('cleuberaparecido@quartavia.com.br', 'eps'),
    ('cleuberaparecido@quartavia.com.br', 'team_leaders_ep'),
    ('joaoaliceda@quartavia.com.br', 'eps'),
    ('hendrickramos@quartavia.com.br', 'eps'),
    ('juniorteixeira@quartavia.com.br', 'eps'),
    ('lucasdaniel@quartavia.com.br', 'eps'),
    ('pedrogoulart@quartavia.com.br', 'eps'),
    ('felipealeixo@quartavia.com.br', 'eps'),
    ('felipealeixo@quartavia.com.br', 'team_leaders_ep'),
    ('andrielicampesato@quartavia.com.br', 'eps'),
    ('eduardoperoni@quartavia.com.br', 'eps'),
    ('gabrieloliveira@quartavia.com.br', 'eps'),
    ('gabrieloliveira@quartavia.com.br', 'team_leaders_ep'),
    ('gustavomariano@quartavia.com.br', 'eps'),
    ('gustavomariano@quartavia.com.br', 'team_leaders_ep'),
    ('juliocienkonog@quartavia.com.br', 'eps'),
    ('nelsonmarques@quartavia.com.br', 'eps'),
    ('elenicesolovy@quartavia.com.br', 'eps'),
    ('arielzocoli@quartavia.com.br', 'eps'),
    ('danielfentanes@quartavia.com.br', 'eps'),
    ('thiagofreire@quartavia.com.br', 'eps'),
    ('anaavalos@quartavia.com.br', 'eps'),
    ('steffanydutra@quartavia.com.br', 'quality'),
    ('demervaljunior@quartavia.com.br', 'quality'),
    ('lizfidelis@quartavia.com.br', 'quality'),
    ('financeiro@quartavia.com.br', 'finance'),
    ('wilsoncohim@quartavia.com.br', 'finance'),
    ('gabrielcouto@quartavia.com.br', 'finance'),
    ('brennosherlock@quartavia.com.br', 'finance')
) AS links(email, code)
JOIN analytics.dashboard_users u ON u.email = links.email
JOIN analytics.dashboard_access_groups g ON g.code = links.code
ON CONFLICT (user_id, group_id) DO NOTHING;
