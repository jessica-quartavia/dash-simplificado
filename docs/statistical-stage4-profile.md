# Statistical Stage 4 Profile — Cancelamento + Renovação

Gerado em: 2026-08-22T19:21:11.382Z
Calculation version: `v2.2026-08-22-perf-stage4`
Cold runs: 5

## Performance (5 cold runs)

| Métrica | min | p50 | p95/max |
|---|---:|---:|---:|
| wall_ms | 7400 | 8330 | 8475 |
| fetch_ms | 6777 | 7463 | 7758 |
| compute_ms | 555 | 650 | 780 |
| cancelamento_ms | 85 | 110 | 164 |
| renovacao_ms | 58 | 60 | 73 |

## Before / After (Etapa 3 → 4, p50)

| Métrica | Antes | Depois | Ganho % |
|---|---:|---:|---:|
| wall_ms | 10770 | 8330 | 22.7 |
| compute_ms | 4568 | 650 | 85.8 |
| cancelamento_ms | 1864 | 110 | 94.1 |
| renovacao_ms | 2204 | 60 | 97.3 |

## Cancelamento — subetapas (último run)

| Subetapa | ms |
|---|---:|
| numeric_associations | 48 |
| survival | 19 |
| categorical_associations | 18 |
| build_target | 0 |
| ranking_inputs | 0 |

## Renovação — subetapas (último run)

| Subetapa | ms |
|---|---:|
| numeric_associations | 15 |
| categorical_associations | 2 |
| build_renewal_target | 0 |
| compareRenewedVsNot | 0 |
| ranking_inputs | 0 |

## Requests

p50: 29 (meta: <=29)

## Payload

p50: 2846 KB
