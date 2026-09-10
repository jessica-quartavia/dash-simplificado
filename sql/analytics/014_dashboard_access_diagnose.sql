-- Diagnóstico read-only do controle de acesso.
-- Destino: Business Data / Auth (rckpuebaiswrxzmywllv).
-- NÃO executar na BASE QV (lacinxsvjdwalkchxyeo).

SELECT current_database() AS database,
       current_user AS db_user;

SELECT n.nspname AS schema_name
FROM pg_namespace n
WHERE n.nspname = 'analytics';

SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'analytics'
  AND c.relname IN (
    'dashboard_users',
    'dashboard_access_groups',
    'dashboard_user_groups',
    'dashboard_access_audit'
  )
ORDER BY c.relname;

SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname, p.proname) IN (
  ('analytics', 'current_access_email'),
  ('analytics', 'is_dashboard_owner'),
  ('public', 'current_dashboard_access'),
  ('public', 'list_dashboard_access_users')
)
ORDER BY n.nspname, p.proname;

SELECT email, is_owner, is_active
FROM analytics.dashboard_users
WHERE is_owner = true
ORDER BY email;

SELECT email, is_owner, is_active
FROM analytics.dashboard_users
ORDER BY email;

SELECT u.email, g.code
FROM analytics.dashboard_users u
LEFT JOIN analytics.dashboard_user_groups ug ON ug.user_id = u.id
LEFT JOIN analytics.dashboard_access_groups g ON g.id = ug.group_id
ORDER BY u.email, g.code;
