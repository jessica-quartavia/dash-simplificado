# Performance Etapa 2 — Analytics V2

Gerado em: 2026-08-22T19:00:47.255Z
Calculation version: `v2.2026-08-22-perf-stage2`
Baseline antes: `docs/performance-baseline.json`

## Before / After (cold load)

| Página | Cold antes | Cold depois | Ganho % | Requests antes | Requests depois | Rows antes | Rows depois | Payload antes KB | Payload depois KB | Public KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Análises Estatísticas | 22242 | 26324 | -18.4 | 0 | 29 | 0 | 22140 | 2843 | 2845 | 2845 |
| Resumo Executivo | 12157 | 16282 | -33.9 | 36 | 36 | 26559 | 26559 | 88 | 88 | 88 |
| Performance por EP | 13114 | 15511 | -18.3 | 36 | 36 | 26559 | 26559 | 9655 | 9682 | 788 |
| Reuniões | 10769 | 12530 | -16.4 | 0 | 21 | 0 | 17682 | 19783 | 19785 | 5949 |
| Qualidade | 8402 | 8469 | -0.8 | 34 | 34 | 26163 | 26163 | 38 | 38 | — |
| Indicadores Temporais | 5779 | 6522 | -12.9 | 27 | 27 | 22019 | 22019 | 22797 | 22729 | 2551 |
| Cancelamento | 4969 | 5211 | -4.9 | 36 | 36 | 26559 | 26559 | 2366 | 2366 | — |
| Jornada/Onboarding | 4692 | 4541 | 3.2 | 0 | 0 | 0 | 0 | 2395 | 2395 | — |
| Dados Gerais | 2735 | 4524 | -65.4 | 0 | 9 | 0 | 6909 | 6282 | 6283 | — |
| Plano Patrimonial | 3800 | 4278 | -12.6 | 0 | 0 | 0 | 0 | 2016 | 2016 | — |
| Atualização Financeira | 3903 | 4199 | -7.6 | 0 | 0 | 0 | 0 | 3076 | 3076 | — |
| Mecanismos | 3570 | 3821 | -7 | 0 | 12 | 0 | 8015 | 717 | 717 | 672 |
| Pesquisa de Satisfação | 1842 | 2721 | -47.7 | 0 | 7 | 0 | 4691 | 3726 | 3727 | 1150 |
| Renovação | 1685 | 2040 | -21.1 | 0 | 0 | 0 | 0 | 1236 | 1236 | — |
| Uso da Plataforma | 1073 | 1162 | -8.3 | 0 | 0 | 0 | 0 | 266 | 266 | 170 |

## Top 5 gargalos (cold depois)

1. **Análises Estatísticas** — 26324 ms · causa: paginação REST (meetings/clients/attendance)
2. **Resumo Executivo** — 16282 ms · causa: paginação REST (meetings/clients/attendance)
3. **Performance por EP** — 15511 ms · causa: paginação REST (meetings/clients/attendance)
4. **Reuniões** — 12530 ms · causa: paginação REST (meetings/clients/attendance)
5. **Qualidade** — 8469 ms · causa: paginação REST (meetings/clients/attendance)

## Paginação REST (depois)

PostgREST limita cada Range a **1000 linhas** (`DATA_REST_RANGE_MAX`). Page sizes declarados (ex.: 5000) prepara o cliente para quando o teto subir; hoje o ganho de requests vem de **dedupe no contexto**, não de ranges maiores.

| Fonte | rangeSize | requests | rows | fetch_ms |
|---|---:|---:|---:|---:|
| clients | — | 4 | 3429 | 2404 |
| cancellations | — | 1 | 420 | 932 |
| client_financial_data | — | 4 | 3060 | 1881 |
| client_meetings | — | 8 | 7590 | 5461 |
| manual_meetings | — | 2 | 1338 | 713 |
| meeting_attendance | — | 5 | 4803 | 3576 |
| client_implementation_meeting_date | — | 1 | 102 | 290 |
| client_mecanismos | — | 2 | 1087 | 877 |
| mecanismos | — | 1 | 19 | 556 |
| nps_responses | — | 1 | 292 | 477 |
| clients | — | 4 | 3429 | 2110 |
| cancellations | — | 1 | 420 | 856 |
| client_financial_data | — | 4 | 3060 | 1684 |
| client_meetings | — | 8 | 7590 | 4473 |
| manual_meetings | — | 2 | 1338 | 933 |
| meeting_attendance | — | 5 | 4803 | 2171 |
| client_mecanismos | — | 2 | 1087 | 1056 |
| mecanismos | — | 1 | 19 | 380 |
| client_journeys | — | 4 | 3432 | 2210 |
| client_implementation_meeting_date | — | 1 | 102 | 379 |
| nps_responses | — | 1 | 292 | 493 |
| csat_responses | — | 1 | 591 | 792 |
| nps_sends | — | 1 | 379 | 530 |
| cancellation_statuses | — | 1 | 17 | 356 |
| clients | — | 4 | 3429 | 2275 |
| cancellations | — | 1 | 420 | 800 |
| client_financial_data | — | 4 | 3060 | 1678 |
| client_meetings | — | 8 | 7590 | 4550 |
| manual_meetings | — | 2 | 1338 | 902 |
| meeting_attendance | — | 5 | 4803 | 2757 |
| client_mecanismos | — | 2 | 1087 | 796 |
| mecanismos | — | 1 | 19 | 344 |
| client_journeys | — | 4 | 3432 | 1938 |
| client_implementation_meeting_date | — | 1 | 102 | 286 |
| nps_responses | — | 1 | 292 | 513 |
| csat_responses | — | 1 | 591 | 561 |
| nps_sends | — | 1 | 379 | 478 |
| cancellation_statuses | — | 1 | 17 | 291 |
| clients | — | 4 | 3429 | 2306 |
| client_meetings | — | 8 | 7590 | 4712 |
| manual_meetings | — | 2 | 1338 | 718 |
| meeting_attendance | — | 5 | 4803 | 2244 |
| client_implementation_meeting_date | — | 1 | 102 | 171 |
| cancellations | — | 1 | 420 | 807 |
| clients | — | 4 | 3429 | 2131 |
| client_financial_data | — | 4 | 3060 | 1873 |
| client_journeys | — | 4 | 3432 | 2137 |
| client_meetings | — | 8 | 7590 | 4390 |
| manual_meetings | — | 2 | 1338 | 1286 |
| meeting_attendance | — | 5 | 4803 | 2610 |
| client_implementation_meeting_date | — | 1 | 102 | 293 |
| client_mecanismos | — | 2 | 1087 | 877 |
| mecanismos | — | 1 | 19 | 300 |
| nps_responses | — | 1 | 292 | 596 |
| csat_responses | — | 1 | 591 | 647 |
| cancellations | — | 1 | 420 | 997 |
| clients | — | 4 | 3429 | 2454 |
| cancellations | — | 1 | 420 | 859 |
| client_meetings | — | 8 | 7590 | 4904 |
| manual_meetings | — | 2 | 1338 | 1048 |
| meeting_attendance | — | 5 | 4803 | 3081 |
| client_mecanismos | — | 2 | 1087 | 1193 |
| client_financial_data | — | 4 | 3060 | 1780 |
| nps_responses | — | 1 | 292 | 616 |

## Selects reduzidos (canônico contexto)

- **nps_responses / csat_responses (contexto compartilhado):** removidos `raw_payload`, `comment`, `client_name`, `client_email`, `typeform_form_id`
- **Página Satisfação:** mantém select completo via `canonical: false` (precisa de `raw_payload` para fallback de programa)
- **scopeInputs público:** NPS/CSAT slim no `toPublicSatisfactionPayload` (sem raw_payload/comment no wire)

## Fidelidade

Testes existentes (executive-summary, ep-executive-ranking, meetings-fidelity, satisfaction-nps, statistical-crosses-parity) devem ser executados pós-benchmark — delta KPIs esperado: zero.

## Preload

Preloader (`js/page-preloader.js`) inalterado — continua aquecendo páginas via handlers existentes; cache version incrementada para invalidar payloads antigos.

## Próximo gargalo

Análises Estatísticas (26324 ms) — paginação REST (meetings/clients/attendance)

## Recomendação Etapa 3 (RPC — não implementar)

**Primeira RPC candidata:** agregação server-side de `client_meetings` + `meeting_attendance` (KPIs BASE QV: total, recência, frequência, intervalo, no-show) — hoje ~7.5k meetings + ~4.8k attendance dominam requests e cold load em EP/Executive/Reuniões/Estatísticas.

## Segurança

- BASE QV / Pharus read-only
- V1 intacto
- RLS intacto
- Git não executado
