-- Auditoria read-only — App Pharus (qvtqufdivpbmubooawdm)
-- Executar manualmente no SQL Editor do projeto App Pharus.
-- NÃO altera dados. NÃO executar automaticamente pelo portal.
--
-- Resultado esperado HOJE (antes das fases 001):
--   core.mechanisms / user_mechanisms / personal_info → anon count 0 (HTTP 200)
--   metrics.events → permission denied for schema metrics (HTTP 401)
--   postgres count(*) >> 0 nas tabelas core (se houver dados)

-- ============================================================
-- §1 Volume real (como postgres no SQL Editor)
-- ============================================================
SELECT COUNT(*) AS mechanisms FROM core.mechanisms;
SELECT COUNT(*) AS user_mechanisms FROM core.user_mechanisms;
SELECT COUNT(*) AS personal_info FROM core.personal_info;
SELECT COUNT(*) AS pre_registrations FROM core.pre_registrations;
SELECT COUNT(*) AS metrics_events FROM metrics.events;

-- ============================================================
-- §2 Schema analytics existe? (relevante antes da Fase C)
-- ============================================================
SELECT nspname AS schema_name
FROM pg_namespace
WHERE nspname IN ('analytics', 'core', 'metrics')
ORDER BY nspname;

-- ============================================================
-- §3 USAGE no schema (anon, authenticated, public, service_role)
-- ============================================================
SELECT
  n.nspname AS schema_name,
  r.rolname AS grantee,
  has_schema_privilege(r.rolname, n.oid, 'USAGE') AS has_usage
FROM pg_namespace n
CROSS JOIN (
  SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'public', 'service_role')
) r
WHERE n.nspname IN ('core', 'metrics', 'analytics')
ORDER BY n.nspname, r.rolname;

-- ============================================================
-- §4 GRANT SELECT (e outros) nas tabelas/views alvo
-- ============================================================
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.table_privileges
WHERE table_schema IN ('core', 'metrics', 'analytics')
  AND table_name IN (
    'mechanisms',
    'user_mechanisms',
    'personal_info',
    'pre_registrations',
    'events',
    'platform_login_events'
  )
  AND grantee IN ('anon', 'authenticated', 'public', 'service_role')
ORDER BY table_schema, table_name, grantee, privilege_type;

-- ============================================================
-- §5 RLS habilitado?
-- ============================================================
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('core', 'metrics', 'analytics')
  AND c.relname IN (
    'mechanisms',
    'user_mechanisms',
    'personal_info',
    'pre_registrations',
    'events',
    'platform_login_events'
  )
ORDER BY n.nspname, c.relname;

-- ============================================================
-- §6 Policies SELECT (roles, USING, WITH CHECK)
-- ============================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check
FROM pg_policies
WHERE schemaname IN ('core', 'metrics', 'analytics')
  AND tablename IN (
    'mechanisms',
    'user_mechanisms',
    'personal_info',
    'pre_registrations',
    'events',
    'platform_login_events'
  )
ORDER BY schemaname, tablename, policyname;

-- ============================================================
-- §7 Colunas de PII em core.personal_info (inventário)
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name = 'personal_info'
ORDER BY ordinal_position;

-- ============================================================
-- §8 Onde está user_id em metrics.events? (para desenhar Fase C)
--     Alinha com V1/V2 eventClientId: coluna top-level OU metadata JSONB
-- ============================================================
SELECT
  COUNT(*) AS total_login_events,
  COUNT(*) FILTER (WHERE NULLIF(metadata ->> 'user_id', '') IS NOT NULL) AS metadata_user_id,
  COUNT(*) FILTER (WHERE NULLIF(metadata ->> 'userId', '') IS NOT NULL) AS metadata_userId,
  COUNT(*) FILTER (WHERE NULLIF(to_jsonb(e) ->> 'user_id', '') IS NOT NULL) AS column_user_id,
  COUNT(*) FILTER (WHERE NULLIF(to_jsonb(e) ->> 'client_id', '') IS NOT NULL) AS column_client_id,
  COUNT(*) FILTER (WHERE NULLIF(to_jsonb(e) ->> 'distinct_id', '') IS NOT NULL) AS column_distinct_id
FROM metrics.events e
WHERE e.event_name IN ('login_succeeded', 'login_success');

-- Amostra (5 linhas) — revisar manualmente campos reais
SELECT
  id,
  event_name,
  created_at,
  metadata ->> 'user_id' AS metadata_user_id,
  metadata ->> 'userId' AS metadata_userId,
  metadata ->> 'client_id' AS metadata_client_id
FROM metrics.events
WHERE event_name IN ('login_succeeded', 'login_success')
ORDER BY created_at DESC
LIMIT 5;

-- ============================================================
-- §9 Simular visão do role anon (PostgREST)
-- ============================================================
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.role = 'anon';

SELECT COUNT(*) AS anon_sees_mechanisms FROM core.mechanisms;
SELECT COUNT(*) AS anon_sees_user_mechanisms FROM core.user_mechanisms;
SELECT COUNT(*) AS anon_sees_personal_info FROM core.personal_info;
SELECT COUNT(*) AS anon_sees_pre_registrations FROM core.pre_registrations;

-- Deve falhar HOJE: permission denied for schema metrics
SELECT COUNT(*) AS anon_sees_metrics_events FROM metrics.events;

-- Após Fase C aplicada, descomente e teste:
-- SELECT COUNT(*) AS anon_sees_platform_login_events FROM analytics.platform_login_events;

ROLLBACK;

-- ============================================================
-- §10 Distribuição útil pós-liberação (referência)
-- ============================================================
SELECT status, COUNT(*) AS n
FROM core.user_mechanisms
GROUP BY status
ORDER BY n DESC;

SELECT event_name, COUNT(*) AS n
FROM metrics.events
WHERE event_name IN ('login_succeeded', 'login_success')
GROUP BY event_name
ORDER BY n DESC;
