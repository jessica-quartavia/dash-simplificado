# Statistical Compute Profile — Etapa 3

Gerado em: 2026-08-22T19:11:15.191Z
Calculation version: `v2.2026-08-22-perf-stage3`
Cold runs: 3

## Performance (wall cold)

| Métrica | min | p50 | max |
|---|---:|---:|---:|
| total_ms | 10602 | 10770 | 11969 |
| fetch_ms | 6156 | 6174 | 7248 |
| compute_ms | 4384 | 4568 | 4656 |

## Before / After (p50 wall)

| Antes (Etapa 2) | Depois (Etapa 3) | Ganho % |
|---:|---:|---:|
| 26324 | 10770 | 59.1 |

## Compute blocks (último run, ms)

| Bloco | ms |
|---|---:|
| renovacao | 2204 |
| cancelamento | 1864 |
| build_client_features | 60 |
| cohort | 55 |
| general_matrix | 50 |
| predictive_ranking | 50 |
| group_matrix | 46 |
| permanencia | 27 |
| top_clients | 14 |
| nps | 7 |
| active_risk | 4 |
| serialization | 3 |

## Requests

p50: 29 (meta: <=29)

## Payload

p50: 2845 KB
