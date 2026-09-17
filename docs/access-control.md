# Controle de acesso — Analytics V2

Autorização do portal vive no **Business Data / Auth** (`rckpuebaiswrxzmywllv`), schema `analytics`. A BASE QV não entra neste fluxo.

## Allowlist

Google Auth autentica a identidade. `analytics.dashboard_users` autoriza o sistema.

Acesso exige, em conjunto:

1. autenticação Google válida;
2. e-mail corporativo `@quartavia.com.br`;
3. registro existente em `analytics.dashboard_users`;
4. `is_active = true`.

Ter `@quartavia.com.br` **não** basta. Usuários não cadastrados são bloqueados com: **Seu usuário não possui acesso ao Analytics.**

Não há criação automática de `dashboard_users` no login. A lista de Gerenciamento de Acessos é a allowlist oficial.

## Owner

Os Owners têm acesso total, inclusive páginas em construção, conteúdo legado e **Gerenciamento de Acessos**. Owner sobrescreve qualquer time.

Owners iniciais:

- jessicacarvalho@quartavia.com.br
- matheuslacerda@quartavia.com.br
- thassyacosta@quartavia.com.br
- cadubarral@quartavia.com.br
- anagazzo@quartavia.com.br

É obrigatório manter pelo menos um Owner ativo. Um Owner não retira o próprio Owner nem desativa a si mesmo.

## Grupos e herança

O modelo é many-to-many (`dashboard_users` + `dashboard_user_groups`). A permissão final é a **união** dos grupos.

```
ACCESS_GROUP_INHERITANCE = {
  team_leaders_ep: ['eps'],
  product: ['leaders']
}
```

- Team Leader EP herda EP e ganha Relatórios + Performance do EP.
- **Produto herda Líderes**: mesmos dashboards permitidos, sem páginas em construção e sem Gerenciamento de Acessos. Quando Líderes mudar, Produto acompanha.

Menu, rota, API e preload leem a mesma policy. Página escondida no menu também é bloqueada na URL e na API.

## Páginas em construção

Flag `isUnderConstruction` nas páginas com marcador visual 🔧. Owner acessa. Líderes, Produto e demais grupos não acessam, mesmo que o time libere a página.

## Acionamentos — legado owner-only

`PAGE_ACCESS_METADATA.support`:

- `legacy: true`
- `ownerOnly: true`
- `preload: false`
- badge: **Legado**

Comportamento:

- Owner: item clicável, badge Legado, rota e API permitidas. Sem preload.
- Não-owner: item visível, cinza, desabilitado, badge Legado. Rota e API retornam 403 com: **Esta página é um conteúdo legado disponível apenas para Owners.**

## Preload

O preloader só aquece páginas em `allowedPageIds` com `preload !== false`. Gerenciamento de Acessos e Acionamentos nunca entram na fila. Sem permissão, `page-load.js` também não dispara fetch.

## RLS

Usuário autenticado lê o próprio perfil e grupos. Owner lê e gerencia todos. `anon` não tem grant. Helpers `SECURITY DEFINER` usam `auth.jwt() ->> 'email'`, com `search_path` explícito, sem e-mail enviado pelo cliente.

## Matriz (Grupo × páginas)

| Página | Líderes | Produto | EPs | Team Leaders EP | Qualidade | Financeiro | Owner |
|---|---|---|---|---|---|---|---|
| Resumo Executivo | sim | sim | sim | sim | não | sim | sim |
| Dados Gerais | sim | sim | sim | sim | sim | sim | sim |
| Relatórios | sim | sim | não | sim | não | não | sim |
| Jornada / Onboarding | não* | não* | não* | não* | não | não | sim |
| Reuniões | sim | sim | sim | sim | não | não | sim |
| Plano Patrimonial | não* | não* | não* | não* | não | não | sim |
| Mecanismos | sim | sim | sim | sim | não | não | sim |
| Uso da Plataforma | não* | não* | não | não | não | não | sim |
| Atualização Financeira | sim | sim | sim | sim | não | não | sim |
| Acionamentos | legado** | legado** | legado** | legado** | legado** | legado** | sim |
| Pesquisa de Satisfação | sim | sim | sim | sim | sim | não | sim |
| Cancelamento | sim | sim | não | não | sim | sim | sim |
| Renovação | sim | sim | não | não | sim | sim | sim |
| Performance do EP | sim | sim | não | sim | não | não | sim |
| Indicadores Temporais | sim | sim | não | não | não | não | sim |
| Análises Estatísticas | sim | sim | não | não | não | não | sim |
| Health Score | sim | sim | não | não | não | não | sim |
| Qualidade dos Dados | sim | sim | não | não | não | não | sim |
| Documentação de Métricas | sim | sim | não | não | não | não | sim |
| Gerenciamento de Acessos | não | não | não | não | não | não | sim |

\* Página em construção: bloqueada para quem não é Owner.

\*\* Legado: visível no menu, desabilitado para não-owner; rota e API 403.

## SQL

Aplicar manualmente no Business Data:

1. `sql/analytics/012_dashboard_access.sql` — tabelas, RLS e seed
2. `sql/analytics/013_dashboard_access_bootstrap_rpc.sql` — RPC em `public` para o login funcionar sem expor o schema `analytics` na Data API
3. `sql/analytics/015_dashboard_access_mutate_rpc.sql` — upsert/delete via RPC
4. `sql/analytics/016_dashboard_access_product.sql` — grupo Produto, cinco usuários e allowlist do upsert

O schema `analytics` ainda **não** está em Exposed schemas. Sem o RPC, o PostgREST responde `PGRST106 Invalid schema: analytics`.

Diagnóstico read-only: `sql/analytics/014_dashboard_access_diagnose.sql`.
