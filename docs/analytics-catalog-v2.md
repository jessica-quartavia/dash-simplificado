# Catálogo Analítico V2

Fonte de metadados e regras dos indicadores. Não guarda valores dinâmicos (clientes ativos, taxas, contagens ao vivo).

```text
V1 + CSV Dash Kids
        ↓
analytics.metric_catalog   (Business Data)
        ↓
futuro snapshot / context
        ↓
Assistente + Análise Inteligente + Resumo Executivo + dashboards
```

O snapshot (`analytics.metric_snapshot`) está descrito em `docs/analytics-snapshot-v2.md`.

## Onde vive

- Projeto: **Business Data** (`rckpuebaiswrxzmywllv`)
- Schema: `analytics`
- Tabela: `analytics.metric_catalog`
- A **BASE QV é somente leitura** e não recebe esta tabela.

## Como aplicar

1. No SQL Editor do **Business Data/Auth**, rode `sql/analytics/001_metric_catalog.sql`.
2. Em Settings → API, exponha o schema `analytics`.
3. Rode `sql/analytics/002_seed_metric_catalog.sql` (idempotente).
4. Rode `sql/analytics/004_authenticated_access.sql`.
5. Confirme `GET /api/analytics/catalog` com sessão corporativa (`AUTH_SUPABASE_ANON_KEY` + JWT).

O Cursor MCP, nesta etapa, estava conectado à **BASE QV**. Por isso o SQL não foi aplicado automaticamente.

## RLS

RLS está ligado. `anon` não lê nem grava. `authenticated` tem SELECT no catálogo.

O endpoint Vercel valida o e-mail `@quartavia.com.br` via `/auth/v1/user` antes de consultar o PostgREST com o JWT da sessão. O RLS não filtra por e-mail: o app não inspeciona claims do JWT, só `role` (`authenticated`).

## Leitura

`GET /api/analytics/catalog`

Filtros:

- `?page=general`
- `?validated=true`

Não consulta a BASE QV. Responde só com metadados.

## Dash Kids

O texto original do CSV fica em `dash_kids_status` (`Sim`, `Avaliar`, `Recomendação: Não Levar`).

`validated_for_v2 = true` somente se a página já foi trabalhada na V2 **e** `Dash Kids = Sim`.

Páginas já trabalhadas: Dados Gerais, Jornada, Reuniões, Plano Patrimonial, Mecanismos.

## Regenerar seed

```text
node scripts/generate-metric-catalog-seed.mjs
```

Não altera a V1. Não consulta a BASE QV.
