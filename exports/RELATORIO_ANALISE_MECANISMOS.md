# Análise Mecanismos × Renovação × Satisfação

## Resumo executivo

- Base elegível (ciclo válido): **3412** clientes; **225** renovados (taxa observada **6.59%**).
- Comparação com vs sem mecanismo implementado: diferença observada **18.53 p.p.** (OR observado 11.824597663139329, p=0.0000).
- Trata-se de análise **observacional**; associação **não implica causalidade**.

## 1. Visão geral

| Métrica | Valor |
|---------|------:|
| N elegível | 3412 |
| Renovados | 225 |
| Não renovados | 3187 |
| Taxa de renovação | 6.59% |

## 2. Com mecanismo × sem mecanismo

- Sem mecanismo (0): taxa **2.16%** (n=2595).
- Com mecanismo (≥1): taxa **20.69%** (n=817).

## 3. Quantidade de mecanismos × renovação

mechanism_count_group  n_clients  n_renewed  n_not_renewed  renewal_rate_pct  ci95_lower_pct  ci95_upper_pct
                    0       2595         56           2539              2.16            1.67            2.79
                    1        308         32            276             10.39            7.46           14.30
                    2        221         31            190             14.03           10.06           19.22
                    3        154         34            120             22.08           16.25           29.26
                   4+        134         72             62             53.73           45.30           61.95

## 4. Mecanismos individuais × renovação

Ver `stats_renovacao_por_mecanismo.csv` (todos os mecanismos, inclusive não significativos).

## 5. NPS

- Cobertura NPS na base elegível: **427** respondentes com nota válida.

## 6. CSAT

- Cobertura CSAT substancialmente menor que NPS; interpretar com cautela.

## 7. Análise ajustada

Modelos logísticos em `stats_logistic_models.csv` (quantidade e mecanismos, com controles quando convergiram).

## 8. Principais limitações

- Estudo observacional; associação não implica causalidade.
- Não há datas de eventos de renovação (inferência por `ciclo`).
- Viés de permanência/exposição: clientes mais antigos têm mais tempo para mecanismos e renovação.
- Cobertura limitada de NPS e ainda menor de CSAT.
- Export considera mecanismos **BASE QV** (não exclusivos App Pharus).
- Poucos eventos de renovação (~225) limitam modelos multivariados com muitos mecanismos.

## 9. Sugestões para apresentação

- Mostrar taxa geral e comparação com vs sem mecanismo com intervalos de confiança.
- Destacar mecanismos com maior diferença observada **e** amostra adequada (sem esconder negativos).
- Explicitar resultados inconclusivos (amostra pequena ou p≥0,05).
