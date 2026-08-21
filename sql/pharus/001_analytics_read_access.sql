-- Leitura analítica mínima — App Pharus (qvtqufdivpbmubooawdm)
-- Destino: projeto App Pharus ONLY.
-- NÃO executar na BASE QV. NÃO executar no Auth/Business Data.
-- Idempotente. Somente SELECT para anon. Sem INSERT/UPDATE/DELETE.
-- NÃO adiciona PHARUS_SUPABASE_SERVICE_ROLE_KEY ao dashboard.
--
-- EXECUTE APENAS OS BLOCOS NECESSÁRIOS, NA ORDEM:
--   Fase A → mecanismos / consolidado
--   Fase B → NÃO RECOMENDADO AGORA (PII)
--   Fase C → uso da plataforma (view mínima)
--
-- Pré-requisito: sql/pharus/000_audit_pharus_permissions.sql
-- Pós Fase C: Supabase Dashboard → Settings → API → Exposed schemas → incluir `analytics`


-- =============================================================================
-- FASE A — Mecanismos
-- Objetivo: anon lê SOMENTE core.mechanisms e core.user_mechanisms.
-- Campos usados pelo Dash Kids:
--   mechanisms: id, data, created_at, updated_at
--   user_mechanisms: id, user_id, mechanism_id, status, notes, created_at
-- Regra app (sem alterar dados): status suggested → Implementado na consolidação.
-- =============================================================================

-- USAGE no schema NÃO concede SELECT em outras tabelas de core.
GRANT USAGE ON SCHEMA core TO anon;

REVOKE ALL ON TABLE core.mechanisms FROM anon, PUBLIC;
REVOKE ALL ON TABLE core.user_mechanisms FROM anon, PUBLIC;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE core.mechanisms FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE core.user_mechanisms FROM anon, PUBLIC;

GRANT SELECT ON TABLE core.mechanisms TO anon;
GRANT SELECT ON TABLE core.user_mechanisms TO anon;

ALTER TABLE core.mechanisms ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.user_mechanisms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_anon_read_mechanisms ON core.mechanisms;
CREATE POLICY analytics_anon_read_mechanisms
  ON core.mechanisms
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS analytics_anon_read_user_mechanisms ON core.user_mechanisms;
CREATE POLICY analytics_anon_read_user_mechanisms
  ON core.user_mechanisms
  FOR SELECT
  TO anon
  USING (true);

-- Impacto segurança Fase A:
--   Quem possuir PHARUS_SUPABASE_ANON_KEY lê catálogo + vínculos user↔mecanismo.
--   Sem PII direta (personal_info continua fechada).
--   Sem writes.


-- =============================================================================
-- FASE B — Diretório / crosswalk
-- NÃO EXECUTAR AGORA.
--
-- Crosswalk pode funcionar parcialmente só com linked_user_id (BASE QV) após Fase A.
-- Abrir personal_info / pre_registrations expõe nome, e-mail, telefone.
--
-- Se no futuro precisar de Fase B, preferir view mínima (não tabela inteira).
-- Bloco completo mantido comentado para revisão manual.
-- =============================================================================

/*
-- B1. View analítica (sem CPF)
CREATE OR REPLACE VIEW core.analytics_user_directory AS
SELECT
  pi.user_id,
  pi.name,
  pi.alternative_email AS email,
  pi.phone
FROM core.personal_info pi
WHERE pi.user_id IS NOT NULL;

REVOKE ALL ON TABLE core.personal_info FROM anon, PUBLIC;
GRANT SELECT ON TABLE core.analytics_user_directory TO anon;

-- B2. pre_registrations (cautela: e-mail + nome)
REVOKE ALL ON TABLE core.pre_registrations FROM anon, PUBLIC;
GRANT SELECT ON TABLE core.pre_registrations TO anon;
ALTER TABLE core.pre_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_anon_read_pre_registrations ON core.pre_registrations;
CREATE POLICY analytics_anon_read_pre_registrations
  ON core.pre_registrations FOR SELECT TO anon USING (true);

-- Requer alteração de código para ler analytics_user_directory em vez de personal_info.
*/


-- =============================================================================
-- FASE C — Uso da Plataforma
-- Objetivo: anon NÃO acessa metrics.events diretamente.
-- View mínima: id, user_id, event_name, created_at — SEM metadata.
--
-- Extração user_id (mesma ordem V1/V2 eventClientId em platform-usage.mjs):
--   1) colunas top-level user_id, client_id, distinct_id (se existirem)
--   2) metadata.user_id, metadata.userId, metadata.client_id, metadata.distinct_id
--
-- RLS / owner da view:
--   View criada no SQL Editor = owner postgres (padrão Supabase).
--   anon SELECT na view → postgres lê metrics.events ignorando RLS da tabela base.
--   NÃO usar security_invoker = true (PG15+), senão anon herdaria RLS e veria 0 rows.
--   Alternativa se view normal falhar: função SECURITY DEFINER (comentada no fim).
-- =============================================================================

-- Schema analítico dedicado (criar se não existir — conferir §2 do 000 antes).
CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Leitura analítica read-only para Dash Kids. Expor schema em Settings → API → Exposed schemas.';

REVOKE ALL ON SCHEMA metrics FROM anon, PUBLIC;

GRANT USAGE ON SCHEMA analytics TO anon;

CREATE OR REPLACE VIEW analytics.platform_login_events AS
SELECT
  e.id,
  COALESCE(
    NULLIF(to_jsonb(e) ->> 'user_id', ''),
    NULLIF(to_jsonb(e) ->> 'client_id', ''),
    NULLIF(to_jsonb(e) ->> 'distinct_id', ''),
    NULLIF(e.metadata ->> 'user_id', ''),
    NULLIF(e.metadata ->> 'userId', ''),
    NULLIF(e.metadata ->> 'client_id', ''),
    NULLIF(e.metadata ->> 'distinct_id', '')
  ) AS user_id,
  e.event_name,
  e.created_at
FROM metrics.events e
WHERE e.event_name IN ('login_succeeded', 'login_success');

COMMENT ON VIEW analytics.platform_login_events IS
  'Logins App Pharus para analytics. Sem metadata. anon não acessa metrics.events.';

REVOKE ALL ON TABLE metrics.events FROM anon, PUBLIC;
REVOKE ALL ON TABLE analytics.platform_login_events FROM anon, PUBLIC;
GRANT SELECT ON TABLE analytics.platform_login_events TO anon;

-- Impacto segurança Fase C:
--   anon vê apenas logins (2 event_names) com user_id extraído.
--   metadata completa (possível PII) permanece inacessível via anon.
--   Após aplicar: alterar platform-usage.mjs → schema analytics, tabela platform_login_events.

-- Verificação manual pós-Fase C (000 §9):
-- BEGIN; SET LOCAL ROLE anon;
-- SELECT COUNT(*) FROM analytics.platform_login_events;
-- ROLLBACK;

-- -----------------------------------------------------------------------------
-- Alternativa se view retornar 0 apesar de postgres ver linhas na base:
-- função SECURITY DEFINER (owner postgres) — revisar impacto antes de usar.
-- -----------------------------------------------------------------------------
/*
CREATE OR REPLACE FUNCTION analytics.platform_login_events_fn()
RETURNS TABLE (
  id bigint,
  user_id text,
  event_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = metrics, analytics, pg_temp
AS $$
  SELECT
    e.id,
    COALESCE(
      NULLIF(to_jsonb(e) ->> 'user_id', ''),
      NULLIF(to_jsonb(e) ->> 'client_id', ''),
      NULLIF(to_jsonb(e) ->> 'distinct_id', ''),
      NULLIF(e.metadata ->> 'user_id', ''),
      NULLIF(e.metadata ->> 'userId', ''),
      NULLIF(e.metadata ->> 'client_id', ''),
      NULLIF(e.metadata ->> 'distinct_id', '')
    ),
    e.event_name,
    e.created_at
  FROM metrics.events e
  WHERE e.event_name IN ('login_succeeded', 'login_success');
$$;

REVOKE ALL ON FUNCTION analytics.platform_login_events_fn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.platform_login_events_fn() TO anon;
-- Expor via RPC PostgREST se view não resolver.
*/
