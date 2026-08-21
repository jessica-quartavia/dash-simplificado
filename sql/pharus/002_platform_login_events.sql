-- Fase C — Uso da Plataforma (view mínima)
-- Destino: projeto App Pharus ONLY (qvtqufdivpbmubooawdm).
-- NÃO executar na BASE QV. NÃO executar no Auth/Business Data.
-- Somente SELECT para anon. Sem INSERT/UPDATE/DELETE.
-- NÃO adiciona PHARUS_SUPABASE_SERVICE_ROLE_KEY ao dashboard.
--
-- Pré-requisito: auditoria manual (000_audit_pharus_permissions.sql §8) confirmando
-- onde user_id aparece em metrics.events (coluna top-level ou metadata JSONB).
--
-- Pós-aplicação (obrigatório para o dashboard via REST/anon):
--   Supabase Dashboard → Settings → API → Exposed schemas → incluir `analytics`
-- Sem isso PostgREST retorna PGRST106 "Invalid schema: analytics" mesmo com GRANT ok.
--
-- Segurança (view owner postgres, padrão SQL Editor):
--   anon SELECT na view → owner lê metrics.events ignorando RLS da tabela base.
--   NÃO usar security_invoker = true (PG15+), senão anon herdaria RLS e veria 0 rows.
--   anon NÃO recebe USAGE/SELECT em metrics.events diretamente.

CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Leitura analítica read-only para Dash Kids. Expor em Settings → API → Exposed schemas.';

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
  'Logins App Pharus para analytics. Campos: id, user_id, event_name, created_at. Sem metadata.';

REVOKE ALL ON TABLE metrics.events FROM anon, PUBLIC;
REVOKE ALL ON TABLE analytics.platform_login_events FROM anon, PUBLIC;
GRANT SELECT ON TABLE analytics.platform_login_events TO anon;

-- Verificação manual:
-- BEGIN; SET LOCAL ROLE anon;
-- SELECT COUNT(*) FROM analytics.platform_login_events;
-- ROLLBACK;
