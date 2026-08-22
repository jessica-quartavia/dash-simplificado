# Performance Baseline — Analytics V2

Gerado em: 2026-08-22T15:59:21.902Z
Calculation version: `v2.2026-08-22-perf-phase-a`
Cache provider: **memory**

## Resumo por página (cold compute)

| Página | Cold ms | Warm ms | Requests | Rows | Payload KB | Tabela mais lenta |
|---|---:|---:|---:|---:|---:|---|
| Análises Estatísticas | 22242 | 23 | 0 | 0 | 2843 | — |
| Performance por EP | 13114 | 214 | 36 | 26559 | 9655 | client_meetings |
| Resumo Executivo | 12157 | 1 | 36 | 26559 | 88 | client_meetings |
| Reuniões | 10769 | 199 | 0 | 0 | 19783 | — |
| Qualidade | 8402 | 0 | 34 | 26163 | 38 | client_meetings |
| Indicadores Temporais | 5779 | 239 | 27 | 22019 | 22797 | client_meetings |
| Cancelamento | 4969 | 23 | 36 | 26559 | 2366 | client_meetings |
| Jornada/Onboarding | 4692 | 20 | 0 | 0 | 2395 | — |
| Atualização Financeira | 3903 | 17 | 0 | 0 | 3076 | — |
| Plano Patrimonial | 3800 | 12 | 0 | 0 | 2016 | — |
| Mecanismos | 3570 | 7 | 0 | 0 | 717 | — |
| Dados Gerais | 2735 | 28 | 0 | 0 | 6282 | — |
| Pesquisa de Satisfação | 1842 | 51 | 0 | 0 | 3726 | — |
| Renovação | 1685 | 8 | 0 | 0 | 1236 | — |
| Uso da Plataforma | 1073 | 2 | 0 | 0 | 266 | — |

## Top gargalos (cold)

- **Análises Estatísticas** — 22242 ms · 0 requests · 2843 KB · —
- **Performance por EP** — 13114 ms · 36 requests · 9655 KB · client_meetings
- **Resumo Executivo** — 12157 ms · 36 requests · 88 KB · client_meetings
- **Reuniões** — 10769 ms · 0 requests · 19783 KB · —
- **Qualidade** — 8402 ms · 34 requests · 38 KB · client_meetings
- **Indicadores Temporais** — 5779 ms · 27 requests · 22797 KB · client_meetings
- **Cancelamento** — 4969 ms · 36 requests · 2366 KB · client_meetings
- **Jornada/Onboarding** — 4692 ms · 0 requests · 2395 KB · —
- **Atualização Financeira** — 3903 ms · 0 requests · 3076 KB · —
- **Plano Patrimonial** — 3800 ms · 0 requests · 2016 KB · —

## RPC candidatos (proposta — não executar SQL nesta rodada)

- **Análises Estatísticas** — Matrizes NPS/CSAT/meetings — GROUP BY server-side; hoje transfere clients + nps + meetings completos.
- **Resumo Executivo** — KPIs agregados de múltiplos domínios — candidato a snapshot/RPC após bundle compartilhado estabilizado.
- **Performance por EP** — Ranking por EP — agregação COUNT/GROUP BY por engenheiro_patrimonial.
- **Indicadores Temporais** — Séries mensais — bucket por mês no SQL.
- **Qualidade** — Coverage missing fields — COUNT condicional por coluna.
- **Reuniões** — KPIs BASE QV agregados; manter Calendly separado.

## Edge Function

Edge Function **não recomendada nesta fase**. Benchmarks indicam gargalo principal em volume REST + compute JS repetido, não latência Vercel→Supabase isolada. Edge só vale após RPC/agregação server-side comprovada.

## Duplicatas / datasets compartilháveis

Páginas sem AnalyticsDataContext ainda refetcham clients/meetings/financial independentemente. Executive/EP/Temporal/Cancellations/Quality já deduplicam via contexto + shared bundle. Próximo passo: estender contexto às páginas Class-A restantes.
