# Health Score — Analytics V2

Página experimental de classificação de saúde do cliente com duas variáveis oficiais das Análises Estatísticas.

## Variáveis

| Variável | Feature ID | Regra |
|---|---|---|
| Reuniões | `meetingCount` | Total oficial (`client_meetings` + `manual_meetings` exclusivo), pós-entrada |
| Possui mecanismo | `hasMechanism` | Binário: ≥1 vínculo deduplicado na BASE QV (qualquer status) |

Não usa quantidade de mecanismos (`mechanismCount`) nem implementação (`hasFirstImplementation`).

## Score por variável

**Reuniões:** percentil 0–100 do `meetingCount` entre clientes pontuáveis do recorte filtrado.

**Possui mecanismo:**

- Sim → 100
- Não → 0

## Fórmula final

```
Health Score = (ScoreReuniões × PesoReuniões) + (ScoreMecanismo × PesoMecanismo)
```

Pesos em percentual, sempre somando 100%. Default: slider **0.5** (50% engajamento / 50% mecanismos). O slider representa o **peso de mecanismos** (0–1, step 0.05).

## Sem dados

Cliente com `meetingCount === 0` e `hasMechanism !== true` fica **Sem dados** — fora da distribuição Saudável/Atenção/Crítico.

## Classificação (experimental — protótipo)

| Faixa | Score |
|---|---|
| Saudável | ≥ 75 |
| Atenção | 50 a 74 |
| Crítico | < 50 |

## Filtros

- Busca (nome, código, ID)
- EP
- Programa (BASE QV `clients.programa`)
- Status analítico (default: Ativo)
- Classificação

## Pesos

Simulação apenas na sessão atual — não persiste no banco.

Presets removidos — controle único por slider (0 = 100% engajamento, 1 = 100% mecanismos).

Alterar peso recalcula no browser sem novo fetch.

## Arquivos

- Compute: `lib/analytics/health-score.mjs`
- Métricas: `lib/analytics/health-score-metrics.mjs`
- Filtros: `lib/analytics/health-score-filters.mjs`
- UI: `js/health-score.js`
- Rota API: `/api/health-score` → `page=health_score`

## Aviso

Este Health Score está sendo usado para testar regras e pesos. Não representa previsão validada de cancelamento.
