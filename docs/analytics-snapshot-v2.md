# Snapshot Analítico V2

Valores já calculados das métricas **validadas** (`validated_for_v2 = true`).

```text
computes oficiais da V2
        ↓
analytics.metric_catalog   (quais métricas)
        ↓
analytics.metric_snapshot  (valores atuais)
        ↓
futuro Assistente / Análise / Resumo
```

O catálogo explica. O snapshot guarda o valor.

## O que entra

Somente as métricas com `validated_for_v2 = true` no Business Data.

Hoje: 49 (19 general, 2 journey, 12 meetings, 1 plano, 15 mecanismos).

Não entram Avaliar, Não Levar, nem métricas só da V1.

## SQL

Aplicar no SQL Editor do **Business Data/Auth**:

1. `sql/analytics/003_metric_snapshot.sql`
2. `sql/analytics/004_authenticated_access.sql`

Não executar na BASE QV. O MCP do Cursor continua na BASE QV.

Expor o schema `analytics` na Data API (Settings → API).

PostgREST: `apikey = AUTH_SUPABASE_ANON_KEY` e `Authorization: Bearer <JWT da sessão>`.

`anon` não grava. `authenticated` tem SELECT/INSERT/UPDATE no snapshot, sem DELETE.

O domínio `@quartavia.com.br` é validado no endpoint Vercel, não no RLS: este projeto não inspeciona claims de e-mail no JWT.

## Escopos default

- `active_first` → `scope_key=active`
- `historical` → `scope_key=historical` (aquisição mensal e plano)
- `all_clients` → `scope_key=all` (totais de carteira)

Sem combinações extras de filtro nesta versão.

## Erro vs valor válido

Status `error` **não** faz UPSERT. O último snapshot `ok`/`partial` permanece.

## APIs

- `GET /api/analytics/snapshot` — só lê
- `GET /api/analytics/snapshot?page=general`
- `GET /api/analytics/snapshot?metric_id=active_clients`
- `POST /api/analytics/snapshot/refresh` — calcula e grava

Auth corporativa obrigatória. Sem Cron. Sem n8n.

## Preview local

```text
npm run analytics:snapshot:build
```

`--persist` só grava com JWT corporativo (`ANALYTICS_ACCESS_TOKEN` ou `--access-token`). Sem sessão, o persist fica indisponível — anon não escreve.

## Sem PII

Proibido nome, e-mail, CPF, telefone, client_id e listas individuais.
