# Paridade V1 × V2 — Análises Estatísticas

**Data:** 2026-08-21  
**V1 (referência):** `analytics_jornada_cliente/index.html` `#view-statistical-crosses`  
**V2:** `dash-simplificado/js/statistical-crosses.js` + `lib/analytics/statistical-crosses.mjs`  
**Registry de ordem:** `lib/analytics/statistical-sections.mjs`

## Ordem V1 (18 seções principais)

1. Resumo da base analítica  
2. Principais descobertas  
3. Cancelamento — correlações e associações  
4. NPS — matriz de correlação  
5. Renovação — matriz de associação  
6. Permanência — matriz de correlação  
7. Matriz comparativa dos grupos  
8. Ranking preditivo de cancelamento  
9. Combinações de fatores  
10. Curva de sobrevivência  
11. Análise de cohort  
12. Matriz geral de relações entre variáveis  
13. Clientes ativos com sinais detectados  
14. Top clientes — Pharus  
15. Top clientes — Davos  
16. Matriz comparativa NPS (variáveis amplas)  
17. Variáveis excluídas  
18. Qualidade, cobertura e limitações  

## Tabela de paridade

| Ordem | Componente | Tipo | Antes V2 | Depois V2 | Regra reaproveitada | Filtros | Status |
|------:|------------|------|----------|-----------|---------------------|---------|--------|
| 1 | Resumo da base analítica | KPI | PASS | PASS | summary/population payload | Período→contratação, EP, Status, Programa | PASS |
| 2 | Principais descobertas | ranking | PASS | PASS | statistical-discoveries.mjs | População filtrada | PASS |
| 3 | Cancelamento — correlações e associações | matrix/chart/table | PARTIAL | PASS | axisMatrices.cancellation, activeVsCancelled, churnAssociations, univariatePredictivePower, discoveryRankings.cancellation | Todos | PASS |
| 4 | NPS — matriz de correlação | matrix/chart | PARTIAL | PASS | axisMatrices.nps, npsGroups, discoveryRankings.nps | Todos | PASS |
| 5 | Renovação — matriz de associação | matrix/chart | PARTIAL | PASS | axisMatrices.renewal, renewalAssociations, renewedVsNotRenewed | Todos | PASS |
| 6 | Permanência — matriz de correlação | matrix/chart | PARTIAL | PASS | axisMatrices.tenure, tenureCorrelations, tenureBuckets | Todos | PASS |
| 7 | Matriz comparativa dos grupos | heatmap | PASS | PASS | sc-exploratory-ext groupComparative | Todos | PASS |
| 8 | Ranking preditivo de cancelamento | ranking | PARTIAL | PASS | predictiveModel.ranking (multivariável) | Todos | PASS |
| 9 | Combinações de fatores | table | PASS | PASS | riskRules | Todos | PASS |
| 10 | Curva de sobrevivência | survival curve | PASS | PASS | stats-tests Kaplan-Meier + survival-chart.mjs | População filtrada | PASS |
| 11 | Análise de cohort | cohort | PARTIAL | PASS | cohort-retention.mjs + controles UI | Período coorte + população | PASS |
| 12 | Matriz geral Spearman | heatmap | PASS | PASS | correlation-matrix.mjs | População filtrada | PASS |
| 13 | Sinais em clientes ativos | table | MISSING | PASS | sc-client-insights activeRiskSignals | População filtrada | PASS |
| 14 | Top clientes Pharus | ranking | MISSING | PASS | sc-client-insights topClients | Programa + população | PASS |
| 15 | Top clientes Davos | ranking | MISSING | PASS | sc-client-insights topClients | Programa + população | PASS |
| 16 | Matriz comparativa NPS ampla | heatmap | MISSING | PASS | sc-client-insights npsComparative | População filtrada | PASS |
| 17 | Variáveis excluídas | table | PASS | PASS | excludedVariables | Metodológico | PASS |
| 18 | Qualidade e limitações | bloco metodológico | PARTIAL | PASS | qualityWarnings + methodology accordion | — | PASS |

### Sub-componentes do bloco Cancelamento (ordem V1)

| Sub | Componente | Antes | Depois | Status |
|-----|------------|-------|--------|--------|
| 3a | Matriz associação cancelamento | PARTIAL (empilhada) | PASS (seção dedicada) | PASS |
| 3b | Diferença ativos×cancelados (gráfico + unidade) | MISSING | PASS | PASS |
| 3c | AUC univariado (gráfico + tabela) | WRONG ORDER | PASS (dentro cancelamento) | PASS |
| 3d | Associações numéricas/categóricas | PASS | PASS | PASS |
| 3e | Ranking cancelamento | MISSING | PASS | PASS |
| 3f | **Tabela de cancelamento** (diferenças + Leitura) | PARTIAL (sem Leitura) | PASS | PASS |

## Filtros

| Filtro | Ordem UI | Antes | Depois | Semântica |
|--------|----------|-------|--------|-----------|
| Período | 1 | Ausente | PASS | hireFrom/hireTo (contratação) |
| Engenheiro Patrimonial | 2 | EP (4º) | PASS | População antes dos cálculos |
| Status | 3 | PASS | PASS | Status analítico (incl. Congelado, Outros/inativos) |
| Programa | 4 | PASS | PASS | Pharus/Davos — não é Fonte |
| Cobertura mínima / Amostra | 5–6 | PASS | PASS | Client-side scPassMin (V1) |
| Segmento | — | UI | Removido | Conforme escopo V2 |
| Fonte | — | Ausente | Ausente | PASS |

## Matrizes

| Métrica | V1 | V2 antes | V2 depois |
|---------|----|---------:|----------:|
| Eixos analíticos (cancel/NPS/renewal/tenure) | 4 | 4 (1 bloco) | 4 (seções separadas) |
| Grupos comparativos | 1 | 1 | 1 |
| Spearman geral | 1 | 1 | 1 |
| NPS comparativa ampla | 1 | 0 | 1 |
| **Total heatmaps/tabelas ranking** | **6** | **5** | **6** |

Toggle Heatmap/Tabela + Expandir: via `statistical-matrix.js` em todas as matrizes com toolbar.

## Gráficos

| Gráfico | V1 | V2 antes | V2 depois |
|---------|----|---------:|----------:|
| Diff ativos×cancelados | 1 | 0 | 1 |
| AUC univariado | 1 | 1 | 1 (no bloco cancelamento) |
| Associações churn num/cat | 2 | 2 | 2 |
| Associações renewal num/cat | 2 | 0 | 2 |
| NPS grupos | 1 | 0 | 1 |
| Tenure Spearman | 1 | 0 | 1 |
| Ranking bars (cancel/NPS/renewal) | 3 | 0 | 3 |
| Predict multivariável bars | 1 | 0 | 1 |
| Survival KM | 1 | 1 | 1 |
| **Total** | **12+** | **4** | **12+** |

## Tabelas

| Tabela | V1 | V2 antes | V2 depois |
|--------|----|---------:|----------:|
| Cancelamento (diff + Leitura) | 1 | 1 (sem Leitura) | 1 |
| AUC completa | 1 | 1 | 1 |
| Ranking cancelamento | 1 | 0 | 1 |
| NPS grupos | 1 | 0 | 1 |
| Renovados vs não | 1 | 0 | 1 |
| Tenure faixas | 1 | 0 | 1 |
| Ranking multivariável (Observação) | 1 | 1 | 1 |
| Combinações risco | 1 | 1 | 1 |
| Cohort espelho | 1 | 0 | 1 |
| Sinais ativos | 1 | 0 | 1 |
| Top Pharus/Davos | 2 | 0 | 2 |
| Excluídas | 1 | 1 | 1 |

## Semântica de período por seção

| Seção | Campo de data | Respeita período global? |
|-------|---------------|--------------------------|
| KPIs / população | hireDate | Sim (filtro população) |
| Comparações ativos×cancelados | hireDate + status analítico | Sim |
| Associações / matrizes | População filtrada | Sim |
| NPS preditivo | última resposta antes cancelamento | Sim (via população) |
| Sobrevivência KM | hireDate → cancel/now | Sim |
| Coorte | hireDate (cohortPeriod adicional) | Sim + controle local |
| Top clientes / sinais | snapshot população ativa filtrada | Sim |

## Pendências conhecidas (NOT_APPLICABLE / futuro)

| Item | Status | Justificativa |
|------|--------|---------------|
| Seletor matrixVars (até 12 vars) | NOT_APPLICABLE curto prazo | Backend suporta; UI V1 tinha painel dedicado — documentado em unimplementedVisualFilters |
| Export PDF/PNG por seção | NOT_APPLICABLE | Fora do escopo desta rodada; expand/toggle presentes |
| Glossário flutuante V1 | NOT_APPLICABLE | Metodologia consolidada no accordion + alertas |
| Dados técnicos recolhíveis (§15 V1) | NOT_APPLICABLE | Bloco admin V1; qualidade coberta em §18 |

## Fidelidade numérica

Validação recomendada: comparar LIVE V1×V2 com mesmos filtros (programa, status active_cancelled, minCoverage 30, minSample 5):

- N população (`summary.analyzedClients`)
- Linhas tabela cancelamento
- Medianas amostradas activeVsCancelled
- Curva KM em 0/365 dias
- Cohort M3 amostra
- Ranking multivariável top 3 importâncias

**Status automático desta rodada:** layout + paridade estrutural PASS; validação LIVE requer ambiente com API (não executada nesta sessão).

## Segurança

- Fontes read-only: intacto  
- V1 intacto: intacto  
- RLS: intacto  
- Git: não executado  
