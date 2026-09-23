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

## 7. Temporalidade — mecanismo antes do NPS

Entre clientes **com NPS + mecanismo** (248 no Ativo):

- implementado **antes** da resposta NPS;
- implementado **depois**;
- **sem data** suficiente (`implemented_at` / data NPS).

Tabela por mecanismo: antes / depois / sem data / %.

## 8. Tabelas de clientes

- **Com mecanismo + NPS:** cliente, código, EP, programa, segmento, nota, classe, data, qtd. mecanismos, nomes (chips).
- **Sem mecanismo + NPS:** mesmas colunas exceto mecanismos.
- **Por nota (todos):** listagem completa filtrável.

Paginação 25/50/100, busca, export CSV/Excel por tabela (`analise_interna_nps_mecanismos_<slug>_<data>`).

## 9. Insights (UI)

Texto em linguagem simples, sem prefixos técnicos (`comparacao:`, etc.). Inclui NPS, CSAT (se amostra suficiente) e renovação quando aplicável.

## 10. Limitações

- Cobertura NPS parcial na carteira (~25,8% dos ativos filtrados respondem NPS no recorte Ativo).
- CSAT com cobertura menor que NPS.
- Cross-sectional; mecanismo “hoje” vs NPS latest.
- Amostras pequenas por mecanismo → não ranquear como “melhor” com n baixo.
- Associação ≠ causalidade.

## 11. Recomendações analíticas

1. Ler **Grupo com vs sem mecanismo** e distribuição 0–10 antes de ranquear mecanismos.
2. Separar mentalmente **NPS** e **CSAT** (seções distintas na página).
3. Usar temporalidade para contexto, não como prova de efeito.
4. Exportar tabelas com os mesmos filtros da tela para auditoria.

## 12. Segurança e escopo técnico

- Página **owner-only**; BASE QV e Pharus **read-only**; regras oficiais de NPS e mecanismos inalteradas; V1 intacto.
