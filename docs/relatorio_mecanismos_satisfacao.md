# Análise — Mecanismos × Satisfação (NPS + CSAT)

Documento alinhado à página **Análises internas → Mecanismos × Satisfação** (Owner-only). População principal: **clientes únicos com NPS válido** (dedupe oficial), após filtros da barra (Programa, EP, Segmento, Status, etc.).

**Atualizado:** 2026-03-22 · compute ao vivo (BASE QV read-only + Pharus read-only).

## 1. Objetivo

Entre quem respondeu NPS no recorte, qual a relação observada entre possuir mecanismos (e quais) e:

- nota 0–10 e índice/classe NPS;
- CSAT (escala 1–5, seção dedicada);
- renovação de ciclo e temporalidade mecanismo × data NPS.

Associação observacional — **não causalidade**.

## 2. População (filtro padrão Status = Ativo)

| Métrica | Valor (snapshot diagnóstico) |
|--------|------------------------------|
| Clientes com NPS | **398** |
| Com NPS + mecanismo | **248** |
| Com NPS + sem mecanismo | **150** |
| Validação 248 + 150 = 398 | ✓ |
| Cobertura de mecanismo entre respondentes NPS | 62,3% |
| NPS índice — com mecanismo | 58,5 |
| NPS índice — sem mecanismo | 48,7 |
| Nota média 0–10 — com / sem | 8,6 / 8,4 |
| Mediana 0–10 — com / sem | 10 / 10 |

Com **Status = Todos**, clientes com NPS: **442** (263 com mecanismo · 179 sem).

## 3. NPS — comparação com vs sem mecanismo

Tabela **Indicador | Com mecanismo | Sem mecanismo | Diferença**: clientes, índice NPS, nota média, mediana, % promotores / neutros / detratores.

**Teste:** Mann–Whitney U na nota 0–10; efeito rank-biserial (rótulos de força no payload).

**Distribuição 0–10:** gráfico de barras agrupadas (com mecanismo vs sem), com contagem e tooltip percentual.

## 4. Matriz Mecanismos × NPS

Linhas: possui mecanismo, quantidade de mecanismos, cada mecanismo do catálogo.

Colunas (sem nota 0–10 na matriz):

| Coluna | Leitura |
|--------|---------|
| Promotor | associação |
| Neutro | associação |
| Detrator | associação |
| CSAT | média |
| Renovação | taxa % |

Legenda na UI: escala de força (|r|), direção +/-, texto “Como ler esta matriz?”.

Amostra mínima para destaque em ranking/insights: **n ≥ 10** na UI (⚠ “Amostra pequena”); matriz usa regra estatística existente do projeto para células.

## 5. CSAT × Mecanismos (seção dedicada)

Comparação **com vs sem mecanismo** entre clientes já no universo NPS:

- clientes com CSAT válido, média, mediana, % satisfeitos / não satisfeitos.

Tabela por mecanismo: clientes com CSAT, médias, mediana, satisfeitos %, cobertura.

Distribuição **1–5** (com vs sem), quando há respostas CSAT no recorte.

Snapshot Ativo: **69** respondentes CSAT no universo NPS; CSAT médio agregado ~**4,9** (ver KPIs ao vivo).

Insights CSAT automáticos só quando **n ≥ 10** em ambos os grupos.

## 6. Renovação × Mecanismo

Comparação com/sem mecanismo: elegíveis, renovados, taxa %.

Por mecanismo: elegíveis, renovados, taxa, diferença vs sem mecanismo, cobertura.

Taxa agregada no recorte Ativo: ~**21,2%** (payload secundário).

## 7. Projeção de renovação até o final do ano

**Status oficial de elegibilidade:** ainda **indisponível** (sem `renewal_date` / evento de renovação).

**Proxy validado (BASE QV, read-only, set/2026):** classificação **B — proxy razoável** para `clients.data_fim_ciclo` como **fim do ciclo corrente** (não data oficial de renovação).

### Significado de `data_fim_ciclo` (evidência no código)

| Fonte | Uso |
|--------|-----|
| `general-data.mjs` | `cycleEndDate` |
| `renewal.mjs` | Coluna “Fim do ciclo” |
| `cancellations.mjs` | Cancelamento antes vs após fim de ciclo |
| Catálogo métricas | `renewal_on_time` indisponível |

Preenchimento: operacional na BASE QV (sem ETL no repositório).

### Cobertura (ativos, carteira completa)

| | N | % |
|--|--|--|
| Ativos | 1 625 | — |
| Com `data_inicio_ciclo` | 1 286 | 79,1% |
| Com `data_fim_ciclo` | 1 375 | 84,6% |
| Com ambos | 1 286 | 79,1% |
| Sem nenhum | 250 | 15,4% |

### Duração `data_fim_ciclo − data_inicio_ciclo` (ciclo 1, n=1 058)

| Mediana | p25 | p75 | Média |
|---------|-----|-----|-------|
| 365 d | 365 | 365 | ~380 d |

Ciclos ≥2: mediana **730 d** em parte dos casos (sugere que o par início/fim nem sempre representa só o último ano após renovação) — limitação documentada.

### Qualidade

| Problema | % ativos / pares |
|----------|------------------|
| Fim de ciclo no passado (ativo) | 10,8% |
| Fim &lt; início | 0,2% |
| Duração atípica (&lt;30 ou &gt;800 d) | 5,3% dos pares |

### Horizonte PROXY até 31/12/2026

Rotulo: **“Clientes com fim de ciclo até 31/12”** (não “elegíveis oficiais”).

| Total | Pharus | Davos |
|-------|--------|-------|
| 259 | 212 | 47 |

Distribuição mensal: set/2026 **16** · out **155** · nov **45** · dez **43**.

### Projeção exploratória (somente PROXY B)

Badge **PROXY / EXPLORATÓRIO**. Modelo: taxa estratificada programa × qtd. mecanismos (shrinkage), target `ciclo > 1`, holdout 20%.

| KPI | Valor |
|-----|-------|
| Renovações esperadas | **~39** (faixa **33–45**) |
| Taxa esperada no horizonte | **15,1%** |
| Taxa base (treino) | **13,5%** |
| Brier (teste) | **0,095** (baseline **0,116**) |
| AUC univariado (qtd. mecanismos) | **0,79** |

**Top 3 mecanismos associados à renovação** (histórico, N≥10; não causalidade):

1. Crédito Verde — taxa **66,7%**, Δ **+54,9 p.p.**, N=39  
2. Escala Imobiliária — **55,2%**, Δ **+43,7 p.p.**, N=58  
3. Renda Sintética — **49%**, Δ **+37 p.p.**, N=51  

Export na UI: `projecao_renovacao_ate_fim_do_ano.csv` / Excel (colunas conforme especificação).

Script de auditoria: `node scripts/validate-data-fim-ciclo-proxy.mjs` → `exports/validate_data_fim_ciclo_proxy.json`.

### Limitações

- Proxy **não** substitui data oficial de renovação.  
- Viés de permanência / mecanismos atuais.  
- Reconstrução fim ciclo anterior → pós-renovação **impossível** sem histórico de ciclos.

## 8. Temporalidade — mecanismo antes do NPS

Entre clientes **com NPS + mecanismo** (248 no Ativo):

- implementado **antes** da resposta NPS;
- implementado **depois**;
- **sem data** suficiente (`implemented_at` / data NPS).

Tabela por mecanismo: antes / depois / sem data / %.

## 9. Tabelas de clientes

- **Com mecanismo + NPS:** cliente, código, EP, programa, segmento, nota, classe, data, qtd. mecanismos, nomes (chips).
- **Sem mecanismo + NPS:** mesmas colunas exceto mecanismos.
- **Por nota (todos):** listagem completa filtrável.

Paginação 25/50/100, busca, export CSV/Excel por tabela (`analise_interna_nps_mecanismos_<slug>_<data>`).

## 10. Insights (UI)

Texto em linguagem simples, sem prefixos técnicos (`comparacao:`, etc.). Inclui NPS, CSAT (se amostra suficiente) e renovação quando aplicável.

## 11. Limitações

- Cobertura NPS parcial na carteira (~25,8% dos ativos filtrados respondem NPS no recorte Ativo).
- CSAT com cobertura menor que NPS.
- Cross-sectional; mecanismo “hoje” vs NPS latest.
- Amostras pequenas por mecanismo → não ranquear como “melhor” com n baixo.
- Associação ≠ causalidade.

## 12. Recomendações analíticas

1. Ler **Grupo com vs sem mecanismo** e distribuição 0–10 antes de ranquear mecanismos.
2. Separar mentalmente **NPS** e **CSAT** (seções distintas na página).
3. Usar temporalidade para contexto, não como prova de efeito.
4. Exportar tabelas com os mesmos filtros da tela para auditoria.

## 13. Segurança e escopo técnico

- Página **owner-only**; BASE QV e Pharus **read-only**; regras oficiais de NPS e mecanismos inalteradas; V1 intacto.

## 14. Renovação — população canônica e auditoria do modelo (2026-09-25)

### População

- **`canonicalRenewalPopulation`**: carteira wide após filtros operacionais da página (status, programa, EP, segmento, mecanismo, busca, renovação), **sem** `npsScore` / `npsClass`.
- **Regra oficial de renovação**: `clients.ciclo > 1` ⇒ renovou (`lib/analytics/client-cycle-renewal.mjs`).
- Seções alimentadas: Renovação × mecanismo, Top 3, faixas de mecanismos, projeção 31/12, exports de renovação.
- NPS/CSAT permanecem apenas nas seções de satisfação.

### Auditoria “15 vs 40” (ativos, snapshot BASE QV)

| Métrica | População | Valor típico |
|--------|-----------|--------------|
| Renovados sem mecanismo (elegíveis) | `npsPopulation` (legado) | **15** |
| Renovados sem mecanismo (elegíveis) | `canonicalRenewalPopulation` | **40** |

Os **15** vinham do recorte que exigia NPS na população principal; **40** é o confronto correto na população de renovação (ativos, ciclo válido, sem mecanismo implementado, já renovados).

### Modelo exploratório (projeção PROXY)

- **Algoritmo real**: taxas estratificadas `programa × faixa de mechanism_count (0…4+)` com shrinkage; holdout 20% por hash de `client_id`.
- **Não** é regressão logística com coeficientes por feature nesta versão — rankings associativos por mecanismo usam taxas históricas vs sem mecanismo.
- **Target**: `renewed_binary` = 1 se `ciclo > 1`, 0 se 1º ciclo, entre `cycleValid`.
- **Excluídos do predictClient**: NPS, CSAT, binários `implemented_*` (usados só em rankings descritivos).
- **Métricas holdout** (referência ativos): ROC-AUC ≈ 0,77; Brier ≈ 0,095 (baseline ≈ 0,117); acurácia ≈ 0,87 com baseline “sempre não renova” ≈ 0,94 — ver bloco **Como calculamos?** na seção 9.
- **Utilidade**: ranking PASS; volume (soma de probabilidades) PASS; classificação binária individual ATENÇÃO (classe minoritária).
- **Backtest temporal**: não disponível (sem data oficial de evento de renovação).

Script reprodutível: `node scripts/audit-ims-renewal-model.mjs` (requer `.env` DATA_SUPABASE_*).
