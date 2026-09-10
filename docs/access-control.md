# Controle de acesso — Analytics V2

Autorização do portal vive no **Business Data / Auth** (`rckpuebaiswrxzmywllv`), schema `analytics`. A BASE QV não entra neste fluxo. Login continua Google + Supabase Auth; ter `@quartavia.com.br` não basta.

## Owner

Os Owners têm acesso total, inclusive páginas em construção e **Gerenciamento de Acessos**. Owner sobrescreve qualquer time.

Owners iniciais:

- jessicacarvalho@quartavia.com.br
- matheuslacerda@quartavia.com.br
- thassyacosta@quartavia.com.br
- cadubarral@quartavia.com.br
- anagazzo@quartavia.com.br

É obrigatório manter pelo menos um Owner ativo. Na primeira versão, um Owner não retira o próprio Owner nem desativa a si mesmo.

## Múltiplos grupos

O modelo é many-to-many (`dashboard_users` + `dashboard_user_groups`). A permissão final é a **união** dos grupos. Team Leader EP herda EP (`team_leaders_ep → eps`).

## Páginas em construção

Flag `isUnderConstruction` nas páginas com marcador visual 🔧. Owner acessa. Líderes e demais grupos não acessam, mesmo que o time libere a página.

## Preload

O preloader só aquece páginas em `allowedPageIds`. Gerenciamento de Acessos nunca entra na fila. Sem permissão, `page-load.js` também não dispara fetch.

## RLS

Usuário autenticado lê o próprio perfil e grupos. Owner lê e gerencia todos. `anon` não tem grant. Helpers `SECURITY DEFINER` usam `auth.jwt() ->> 'email'`, com `search_path` explícito, sem e-mail enviado pelo cliente.

## Matriz (Grupo × páginas)

| Página | Líderes | EPs | Team Leaders EP | Qualidade | Financeiro | Owner |
|---|---|---|---|---|---|---|
| Resumo Executivo | sim | sim | sim | não | sim | sim |
| Dados Gerais | sim | sim | sim | sim | sim | sim |
| Relatórios | sim | não | sim | não | não | sim |
| Jornada / Onboarding | não* | não* | não* | não | não | sim |
| Reuniões | sim | sim | sim | não | não | sim |
| Plano Patrimonial | não* | não* | não* | não | não | sim |
| Mecanismos | sim | sim | sim | não | não | sim |
| Uso da Plataforma | não* | não | não | não | não | sim |
| Atualização Financeira | sim | sim | sim | não | não | sim |
| Acionamentos | não* | não* | não* | não* | não | sim |
| Pesquisa de Satisfação | sim | sim | sim | sim | não | sim |
| Cancelamento | sim | não | não | sim | sim | sim |
| Renovação | sim | não | não | sim | sim | sim |
| Performance do EP | sim | não | sim | não | não | sim |
| Indicadores Temporais | sim | não | não | não | não | sim |
| Análises Estatísticas | sim | não | não | não | não | sim |
| Health Score | sim | não | não | não | não | sim |
| Qualidade dos Dados | sim | não | não | não | não | sim |
| Documentação de Métricas | sim | não | não | não | não | sim |
| Gerenciamento de Acessos | não | não | não | não | não | sim |

\* Página em construção: bloqueada para quem não é Owner.

## SQL

Aplicar manualmente no Business Data:

1. `sql/analytics/012_dashboard_access.sql` — tabelas, RLS e seed
2. `sql/analytics/013_dashboard_access_bootstrap_rpc.sql` — RPC em `public` para o login funcionar sem expor o schema `analytics` na Data API

O schema `analytics` ainda **não** está em Exposed schemas. Sem o RPC, o PostgREST responde `PGRST106 Invalid schema: analytics`.

Diagnóstico read-only: `sql/analytics/014_dashboard_access_diagnose.sql`.
