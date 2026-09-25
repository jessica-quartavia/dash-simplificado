# Modelo B — Histórico temporalmente comparável

Gerado: 2026-09-25T18:11:17.524Z

## Resumo leigo

**Modelo A:** aprende apenas com clientes **ativos** (snapshot atual).

**Modelo B:** aprende com **histórico resolvido** — só entram clientes da **era dos mecanismos**, com **exposição mínima auditada** e desfecho de renovação **já observável**. Usar os 3k+ clientes direto mistura épocas sem mecanismos com “não renovou” e distorce o target.

**Produção:** continua no Modelo A (projeção 31/12 intacta). Modelo B é experimento offline.

---

## 1. Por que criamos o Modelo B

Comparar o mesmo estimador (programa × faixa de mecanismos) numa população **temporalmente justa**, incluindo cancelados e ciclos encerrados, sem tratar pré-era como “sem mecanismo + não renovou”.

## 2. Problema de usar a base inteira diretamente

Antes da adoção sistemática, clientes não tinham oportunidade real de mecanismos; o target histórico misturaria **não renovou** com **ainda não estava na operação de mecanismos**.

## 3. Início da era dos mecanismos

| Marco | Valor |
| --- | --- |
| Primeira implementação registrada | 2025-01-01 |
| Início experimental (série) | 2025-01 |
| Adoção relevante | 2026-01 |
| Estabilização operacional (3 meses) | — |
| **MECHANISM_ERA_START (primário)** | 2026-01-01 — Primeiro mês com >= 66 clientes na 1ª implementação OU >= 125 implementações. |

Série mensal completa: `exports/modelo_renovacao_historico_population_audit.csv`.

## 4. Regra de exposição

Dias entre max(entry_date, era_start) e min(cancelamento, hoje), exigindo >= 118 (P25 auditado).

Parâmetros: mínimo **118** dias (P25 auditado: 118).

## 5. Quem entra

População canônica `canonicalHistoricalRenewalPopulation` (primário: corte **Corte intermediário**).

| | N |
| --- | ---: |
| Total resolvido | 1064 |
| Renovados | 137 |
| Não renovados | 927 |
| Com mecanismo (antes de reference_date) | 187 |
| Sem mecanismo | 877 |
| Taxa base | 12.9% |

## 6. Quem fica de fora

| Motivo | N |
| --- | ---: |
| Antes da era | 389 |
| Exposição insuficiente | 472 |
| Resultado ainda aberto | 1487 |
| Ciclo inválido | 34 |
| Sem reference_date | 0 |

## 7. Target

- **y=1:** renovação observada (ciclo > 1).
- **y=0:** cancelamento sem renovação ou janela de ciclo encerrada sem renovação (`data_fim_ciclo` como proxy B, validado na Etapa 1).
- Excluídos: desfecho ainda aberto (“ainda não chegou à renovação” ≠ “não renovou”).
- Features e contagem de mecanismos: somente implementações com `implementation_date <= reference_date`.

## 8. Modelo B1

Mesmo estimador do Modelo A: **programa × faixa (0/1/2/3/4+)** com shrinkage, `minStratumN=5`, clip [0,05–0,95]. Objetivo: isolar efeito da **população**.

## 9. Treino / teste

| | Modelo B |
| --- | --- |
| Tipo (métricas oficiais B1) | hash_holdout_client_id_seed_42 |
| Primário | hash |
| Treino | 853 (eventos: 112) |
| Teste | 211 (eventos: 25) |
| Data de corte temporal | — |

> **Validação temporal:** Out-of-time por reference_date inviável: renovados concentram data_fim_ciclo futura; os 8 primeiros eventos positivos só aparecem após ~88% da série ordenada. Métricas B1 usam hash holdout (igual ao A); ver split temporal ilustrativo no snapshot.

**Split temporal ilustrativo** (não usado como métrica principal): corte 2026-09-11, treino 851, teste 213, ROC-AUC 0.5373219373219373, Brier 0.5716. Métricas ilustrativas — treino com poucos renovados (reference_date).

Modelo A: hash holdout 80/20 (seed 42), n treino 1278, n teste 314.

## 10. Métricas

| Métrica | Modelo A | Modelo B |
| --- | --- | --- |
| populacao | 1592 | 1064 |
| n_treino | 1278 | 853 |
| n_teste | 314 | 211 |
| taxa_base | 0.1354 | 0.13130128956623682 |
| accuracy | 0.8662 | 0.9147 |
| baseline_accuracy | 0.9363 | 0.9479 |
| balanced_accuracy | 0.5835 | 0.6746 |
| precision | 0.4 | 0.8182 |
| recall | 0.2105 | 0.36 |
| f1 | 0.2759 | 0.5 |
| roc_auc | 0.7665 | 0.8633 |
| pr_auc | 0.3146 | 0.6573 |
| brier | 0.095 | 0.0622 |
| baseline_brier | 0.117 | 0.1141 |

### Modelo B — limiares (matriz de confusão)

| Limiar | TP | FP | TN | FN | Accuracy | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 18 | 13 | 173 | 7 | 0.9052 | 0.72 | 0.6429 |
| 0.3 | 18 | 13 | 173 | 7 | 0.9052 | 0.72 | 0.6429 |
| 0.4 | 18 | 13 | 173 | 7 | 0.9052 | 0.72 | 0.6429 |
| 0.5 | 9 | 2 | 184 | 16 | 0.9147 | 0.36 | 0.5 |

## 11. Calibração (holdout B1)

| Bin | N | Previsto | Observado |
| --- | --- | --- | --- |
| 0–10% | 166 | 0.05 | 0.03 |
| 10–20% | 14 | 0.137 | 0.143 |
| 20–40% | 0 | — | — |
| 40–60% | 24 | 0.467 | 0.5 |
| 60%+ | 7 | 0.785 | 0.857 |

## 12. Mecanismos × renovação (população B)

Arquivo `exports/modelo_renovacao_historico_mecanismos.csv`.

**Top taxa bruta (N≥30):** Escala Imobiliária (87.8%); Crédito Verde (81.1%); Fundo de Investimento (QVRA11) (77.6%)

**Top delta vs sem mecanismo:** Escala Imobiliária (+84.7 p.p.); Crédito Verde (+78 p.p.); Fundo de Investimento (QVRA11) (+74.6 p.p.)

### Faixas de quantidade (antes da janela)

| Faixa | N | Renovados | Taxa % |
| --- | --- | --- | --- |
| 0 | 877 | 27 | 3.1 |
| 1 | 48 | 19 | 39.6 |
| 2 | 42 | 20 | 47.6 |
| 3 | 39 | 21 | 53.8 |
| 4+ | 58 | 50 | 86.2 |

## 13. Sensibilidade à data de corte da era

| Corte | N | Taxa % | ROC-AUC | PR-AUC | Brier | Modelo OK |
| --- | --- | --- | --- | --- | --- | --- |
| ample | 1438 | 9.5 | 0.8729 | 0.6461 | 0.0454 | sim |
| intermediate | 1064 | 12.9 | 0.8633 | 0.6573 | 0.0622 | sim |
| conservative | 316 | 58.5 | 0.7698 | 0.7811 | 0.2019 | sim |



## 14. Comparação com Modelo A

- **Onde A tende a ser mais forte:** ranking (ROC-AUC 0.7665 vs 0.8633), base ativa alinhada à projeção de produção.
- **Onde B contribui:** target histórico mais justo para cancelados/ciclos fechados; taxa base observada 12.9% vs ~13.5% (A, ativos).
- **Não declarar vencedor automático** — ver dimensões abaixo.

| Dimensão | Modelo B |
| --- | --- |
| Ranking (ROC/PR) | PASS |
| Classificação | ATENÇÃO |
| Volume / calibração | PASS |
| Qualidade da população | ATENÇÃO |
| Validação temporal | FRACO |

## 15. Limitações

- `reference_date` para renovados usa `data_fim_ciclo` (muitas datas futuras) — impede holdout temporal balanceado; métricas B1 espelham hash do A.
- Proxy B para não renovação; reuniões/NPS não entram no B1.
- B2 (variáveis extras) **não implementado**.

## 16. Próximos passos

- Refinar data de decisão de renovação (pré-evento) para validação out-of-time real.
- Avaliar B2 só após auditoria de leakage (`b2_features_audit` no snapshot).
- Manter projeção de produção no Modelo A até decisão explícita.

---

## Resultado final (checklist)

### Era dos mecanismos
- Primeira implementação: 2025-01-01
- Adoção relevante: 2026-01
- Cutoffs testados: ample=2025-06, intermediate=2026-01, conservative=2026-08

### População B (primário)
- N: 1064 | renovados: 137 | não renovados: 927
- com mecanismo: 187 | sem: 877

### Excluídos
- antes da era: 389 | sem exposição: 472 | aberto: 1487 | outros: 34

### Split B1
- tipo: hash_holdout_client_id_seed_42
- treino: 853 | teste: 211

### Performance B
accuracy 0.9147 | baseline 0.9479 | balanced 0.6746 | precision 0.8182 | recall 0.36 | F1 0.5 | ROC-AUC 0.8633 | PR-AUC 0.6573 | Brier 0.0622 | baseline Brier 0.1141

### Performance A
accuracy 0.8662 | balanced 0.5835 | recall 0.2105 | F1 0.2759 | ROC-AUC 0.7665 | PR-AUC 0.3146 | Brier 0.095

### Recomendação
Não escolher vencedor só por accuracy. A permanece na produção; B informa coerência populacional e limites do proxy temporal.

### Segurança
BASE QV read-only · V1 intacto · Modelo A intacto · Git não executado

---

Artefatos: `exports/modelo_renovacao_historico_*.csv/json`, `docs/relatorio_modelo_renovacao_historico.md`.
