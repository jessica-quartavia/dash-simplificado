# Modelo de Renovação — Referência Base Ativa

*Baseline para futura comparação com metodologia histórica.*

Gerado em: 2026-09-25T17:53:20.234Z  
Versão: `baseline-active-v1-2026-09-25-ims-renewal-population-v1-v2.2026-09-25-ims-renewal-canonical-population`  
Fonte: BASE QV (read-only) · população `analyticalStatus === "Ativo"` · sem NPS no universo de renovação.

---

## 1. Objetivo

Documentar e congelar o desempenho do **modelo exploratório atual** de renovação, treinado **somente sobre clientes ativos** com ciclo válido, antes de construir (Etapa 2) uma alternativa com base histórica completa.

---

## 2. Quem entra na análise

| Indicador | Valor (live) |
|-----------|--------------|
| Ativos oficiais | 1616 |
| Universo canônico de renovação (filtros IMS, status ativo) | 1616 |
| Com ciclo válido (elegíveis) | 1592 |
| Já renovaram (ciclo > 1) | 211 |
| Ainda sem renovação registrada (ciclo = 1) | 1381 |
| Com mecanismo implementado | 764 |
| Sem mecanismo | 852 |

---

## 3. O que significa “renovou”

- **Renovou (rótulo 1):** `clients.ciclo > 1` (após parse oficial).
- **Ainda sem renovação registrada (rótulo 0):** `clients.ciclo = 1` entre elegíveis.

**Limitação importante:** um cliente **ativo no primeiro ciclo** pode simplesmente **não ter chegado** à janela de renovação. O grupo com rótulo 0 **não** deve ser lido como “clientes que não renovaram” sem essa ressalva.

---

## 4. Como o modelo funciona (sem alteração nesta etapa)

Estimador: **taxas estratificadas** por **programa × faixa de quantidade de mecanismos** (0, 1, 2, 3, 4+), com **shrinkage** e holdout **80/20** por hash de `client_id` (seed 42).

Treino: clientes **ativos** com `cycleValid` e rótulo binário definido acima. **Não** entram cancelados/congelados no treino.

---

## 5. Fórmula (parâmetros reais do código)

- **taxa_base** = renovados_treino / clientes_treino  
- **taxa_ajustada(k)** = (renovados_estrato + 2 × taxa_base) / (clientes_estrato + 2) quando **N_estrato ≥ 5**  
- Caso contrário: **p_i = taxa_base**  
- **Clip:** p_i ∈ **[0,05 ; 0,95]**

Implementação: `lib/analytics/internal-mechanisms-renewal-exploratory-projection.mjs` (`buildStrataRates`, `predictClient`).

---

## 6. Variáveis usadas na previsão individual

| Entra no predict | Não entra no predict |
|------------------|----------------------|
| Programa (Pharus/Davos) | Mecanismos específicos (ARCADIA, etc.) |
| Faixa 0/1/2/3/4+ de mecanismos | NPS / CSAT |

Mecanismos nomeados aparecem apenas em **análises descritivas** e rankings — **não** na fórmula preditiva.

---

## 7. Treino / teste

| | |
|--|--|
| Treino | 1278 (80%) |
| Teste | 314 (20%) |
| Renovados treino | 173 |
| Não renovados / ainda sem reg. treino | 1105 |
| Renovados teste | 38 |
| Não renovados / ainda sem reg. teste | 276 |
| Regra split | hash holdout por client_id |

---

## 8. Métricas (holdout — base ativa)

| Métrica | Valor |
|---------|-------|
| Accuracy | 0.8662 |
| Baseline accuracy | 0.9363 |
| Balanced accuracy | 0.5835 |
| Precision (t=0,5) | 0.4 |
| Recall | 0.2105 |
| Specificity | 0.9565 |
| F1 | 0.2759 |
| ROC-AUC | 0.7665 |
| PR-AUC | 0.3146 |
| Brier | 0.095 |
| Baseline Brier | 0.117 |

### Explicação simples

- **Accuracy:** acerto global no teste — enganosa se quase todos são “ainda sem renovação registrada”.
- **Baseline accuracy:** sempre chutar “não renova”.
- **Balanced accuracy:** média de sensibilidade e especificidade.
- **Precision / Recall / F1:** trade-off ao marcar “renova” no corte 0,5.
- **ROC-AUC / PR-AUC:** capacidade de **ordenar** quem renova (PR-AUC importante para classe rara).
- **Brier:** erro das probabilidades; útil para **volume** (soma das p).

---

## 9. Matriz de confusão (threshold = 0.5)

| | |
|--|--|
| TP | 8 |
| FP | 12 |
| TN | 264 |
| FN | 30 |

---

## 10. Sweep de thresholds (teste)

| Threshold | Pred. positivos | Accuracy | Bal. acc. | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 49 | 0.8439 | 0.6957 | 0.3878 | 0.5 | 0.4368 |
| 0.3 | 26 | 0.8662 | 0.6176 | 0.4231 | 0.2895 | 0.3438 |
| 0.4 | 26 | 0.8662 | 0.6176 | 0.4231 | 0.2895 | 0.3438 |
| 0.5 | 20 | 0.8662 | 0.5835 | 0.4 | 0.2105 | 0.2759 |

---

## 11. Calibração (holdout)

| Faixa prevista | N | Prob. média | Taxa observada |
| --- | --- | --- | --- |
| 0–10% | 169 | 0.05 | 0.03 |
| 10–20% | 89 | 0.134 | 0.135 |
| 20–40% | 50 | 0.336 | 0.36 |
| 40–60% | 6 | 0.405 | 0.5 |
| 60%+ | 0 | — | — |

---

## 12. Mecanismos × renovação (base ativa, sem NPS)

Renovados **com** mecanismo: **171** · **sem** mecanismo: **40**.

| Mecanismo | Elegíveis | Renovados | Ainda s/ reg. | Taxa | Taxa s/ mec. | Δ p.p. | Cobertura | Amostra |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Autoconstrução | 348 | 95 | 253 | 27.3% | 4.8% | 22.5 p.p. | 22% | OK |
| Leilão Serial (Flipping de Leilão) | 320 | 99 | 221 | 30.9% | 4.8% | 26.1 p.p. | 20.3% | OK |
| Fundo de Investimento (QVRA11) | 280 | 98 | 182 | 35% | 4.8% | 30.2 p.p. | 17.3% | OK |
| Renda Fixa Escalonada | 213 | 52 | 161 | 24.4% | 4.8% | 19.6 p.p. | 13.4% | OK |
| Trava de Inflação | 142 | 42 | 100 | 29.6% | 4.8% | 24.8 p.p. | 8.8% | OK |
| ARCADIA | 129 | 29 | 100 | 22.5% | 4.8% | 17.7 p.p. | 8% | OK |
| Escala Imobiliária | 75 | 40 | 35 | 53.3% | 4.8% | 48.5 p.p. | 4.8% | OK |
| Renda Sintética | 60 | 28 | 32 | 46.7% | 4.8% | 41.9 p.p. | 3.7% | OK |
| Crédito Verde | 48 | 31 | 17 | 64.6% | 4.8% | 59.8 p.p. | 3% | OK |
| Usinas Escalonáveis (ÂMPAR) | 48 | 15 | 33 | 31.3% | 4.8% | 26.5 p.p. | 3% | OK |
| Incorporação Financiada (ATLAS) | 45 | 17 | 28 | 37.8% | 4.8% | 33 p.p. | 2.8% | OK |

### Taxa por quantidade de mecanismos

| Qtd | Clientes | Renovados | Taxa | Participação |
| --- | --- | --- | --- | --- |
| 0 | 839 | 40 | 4.8% | 52.7% |
| 1 | 266 | 33 | 12.4% | 16.7% |
| 2 | 209 | 28 | 13.4% | 13.1% |
| 3 | 147 | 36 | 24.5% | 9.2% |
| 4+ | 131 | 74 | 56.5% | 8.2% |

### Maiores taxas históricas (amostra ≥ mínimo)

1. **Crédito Verde** — N=48, renovados=31, taxa=64.6%
2. **Escala Imobiliária** — N=75, renovados=40, taxa=53.3%
3. **Renda Sintética** — N=60, renovados=28, taxa=46.7%

### Maior diferença vs sem o mecanismo (não causal)

1. **Crédito Verde** — com 64.6% vs sem 4.8% (Δ 59.8 p.p., N=48)
2. **Escala Imobiliária** — com 53.3% vs sem 4.8% (Δ 48.5 p.p., N=75)
3. **Renda Sintética** — com 46.7% vs sem 4.8% (Δ 41.9 p.p., N=60)

**Nota:** o Top 3 acima **não** compõe a fórmula preditiva (programa + faixa de contagem).

---

## 13. Projeção até 31/12 (proxy `data_fim_ciclo`, só ativos)

| | |
|--|--|
| Clientes no horizonte | 252 |
| Pharus | 207 |
| Davos | 45 |
| Probabilidade média | 15.1% |
| Renovações esperadas (soma p) | 38.1 |
| Faixa estimada | 32 – 44 |

### Por mês (fim de ciclo)

| Mês | Clientes |
| --- | --- |
| 2026-09 | 9 |
| 2026-10 | 155 |
| 2026-11 | 45 |
| 2026-12 | 43 |

---

## 14. O que o modelo faz bem / mal

| Uso | Veredito | Base |
|-----|----------|------|
| Ranking | **PASS** | ROC-AUC / PR-AUC |
| Classificação individual | **ATENÇÃO** | precision / recall / F1 |
| Planejamento de volume | **PASS** | Brier / calibração |


> O modelo acerta 86.6% das classificações no holdout, mas o baseline que prevê "não renova" para todos já acertaria 93.6%. Por isso, balanced accuracy, recall, precision e calibração são mais importantes.


---

## 15. Por que comparar com nova metodologia (Etapa 2)?

O modelo atual usa **somente ativos**, evitando misturar cohorts antigas com a operação recente de mecanismos. Porém:

1. Clientes no **1º ciclo** podem ainda não ter passado pela renovação — o rótulo 0 mistura “não chegou lá” com “não renovou”.
2. A **base histórica completa** (Etapa 2) permitirá outro trade-off entre cobertura temporal e viés de permanência.

---

## 16. Não julgar só por accuracy

Com renovados minoritários, prever sempre “não renova” pode dar accuracy alta. A comparação futura deve priorizar **ROC-AUC, PR-AUC, balanced accuracy, recall, Brier, calibração** e erro de **volume projetado**.

---

## Artefatos

- `exports/modelo_renovacao_base_ativa_snapshot.json`
- `exports/modelo_renovacao_base_ativa_metricas.csv`
- `exports/modelo_renovacao_base_ativa_mecanismos.csv`
