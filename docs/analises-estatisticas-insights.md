# Insights — Análises Estatísticas (snapshot 21/08/2026)

Conteúdo editorial estático. Não recalcular a partir do dashboard live.

## Leitura executiva — Qualidade da amostra

**Insight:** A base analítica é ampla o suficiente para comparações descritivas, mas variáveis-chave como NPS e mecanismos têm cobertura parcial e exigem leitura cautelosa.

**Evidência**
- Clientes analisados: 3.391
- Ativos: 1.721 · Cancelados efetivados: 78
- Cobertura média das variáveis: 62,4%
- Respostas NPS válidas: 11,6% da carteira
- Mecanismos implementados: 18,7% com registro utilizável

**Interpretação:** O recorte consolida clientes ativos e cancelados com regras analíticas oficiais. Indicadores de satisfação e execução patrimonial não alcançam todos os clientes; associações envolvendo NPS ou mecanismos refletem subpopulações menores.

**Ação recomendada:** Priorizar leituras com cobertura ≥ 30% e amostra mínima por grupo antes de tomar decisões operacionais.

**Limitações**
- Congelados e outros status ficam fora de comparações de churn quando aplicável.
- Snapshot fixo; filtros do dashboard podem alterar população sem alterar estes textos.

## Leitura executiva — Principais descobertas

**Insight:** Os sinais mais fortes apontam para relacionamento e cadência de acompanhamento como fatores centrais associados ao cancelamento.

**Evidência**
- Reuniões totais e dias desde última reunião aparecem entre os maiores deltas ativo × cancelado.
- Primeira reunião realizada concentra diferença relevante entre grupos.
- Implementação de mecanismos e atualização financeira também diferenciam perfis, com cobertura desigual.

**Interpretação:** Padrões de contato e marcos de jornada antecedem ou acompanham cancelamentos observados; magnitude estatística não prova causalidade.

**Ação recomendada:** Tratar cadência de reuniões e marcos iniciais como hipóteses operacionais prioritárias para acompanhamento de risco.

**Limitações**
- Descobertas automáticas da página usam regras distintas deste texto estático.
- Combinações multivariadas podem atenuar efeitos individuais.

## Cancelamento

**Insight:** Cancelamentos concentram-se em clientes com menor frequência de reuniões, maior tempo sem contato e menor progresso nos marcos iniciais da jornada.

**Evidência**
- Mediana de reuniões: cancelados abaixo dos ativos no recorte analisado.
- Dias desde última reunião: mediana maior entre cancelados.
- Primeira reunião realizada: proporção menor entre cancelados.
- Variáveis de permanência e ciclo reforçam separação entre grupos.

**Interpretação:** O eixo relacional e de execução da jornada domina as associações observadas com churn efetivado.

**Ação recomendada:** Monitorar clientes ativos com queda de cadência ou atraso em marcos iniciais antes de sinais tardios de insatisfação.

**Limitações**
- Cancelamento confirmado via helper analítico oficial; datas ausentes reduzem precisão temporal.
- Associações categóricas podem refletir composição de carteira por EP ou programa.

## NPS

**Insight:** NPS apresenta associações interpretáveis, porém com cobertura baixa (11,6%); usar como complemento, não como eixo principal de risco.

**Evidência**
- Respostas NPS válidas: 11,6% dos clientes no snapshot.
- Promotores, neutros e detratores distribuem taxas distintas de cancelamento no recorte.
- Correlações com permanência e renovação existem, mas com amostra reduzida.

**Interpretação:** Satisfação medida por NPS ajuda a contextualizar casos, mas não representa a maioria da carteira neste recorte.

**Ação recomendada:** Cruzar NPS com sinais de jornada (reuniões, implementação) quando houver resposta; evitar decisões só com base em NPS isolado.

**Limitações**
- Última resposta por cliente no trimestre/recorte aplicável na página de satisfação.
- Detratores são minoria absoluta; percentuais podem oscilar com poucos casos.

## Renovação

**Insight:** Renovação correlaciona-se mais com permanência, ciclo e engajamento recorrente do que com picos pontuais de satisfação.

**Evidência**
- Clientes renovados (ciclo > 1): 202 no snapshot.
- Variáveis de tempo de casa e reuniões aparecem no ranking de associação com renovação.
- NPS e mecanismos entram com cobertura parcial.

**Interpretação:** Renovação inferida por ciclo reflete continuidade contratual e hábito de uso, não evento formal de renovação.

**Ação recomendada:** Analisar renovação junto à permanência e cadência de contato, não apenas último NPS.

**Limitações**
- Ciclo inválido ou ausente exclui clientes de análises de renovação.
- Proxy de ciclo pode subestimar renovações não registradas na base.

## Permanência

**Insight:** Maior permanência associa-se a clientes com cadência estável de reuniões e marcos de implementação cumpridos.

**Evidência**
- Correlações de Spearman positivas entre permanência e volume de reuniões no recorte.
- Faixas longas de permanência concentram menor taxa de cancelamento relativa.
- Ajuste +365 dias para ciclo ≥ 2 aplicado nas comparações descritivas.

**Interpretação:** Tempo de casa captura efeito acumulado de execução; clientes recentes permanecem mais sensíveis a falhas de onboarding.

**Ação recomendada:** Proteger primeiros 90–180 dias com marcos claros de reunião e implementação.

**Limitações**
- Permanência cronológica difere do ajuste analítico usado em algumas matrizes.
- Sobrevivência e coorte usam regras temporais próprias.

## Matriz de grupos

**Insight:** Grupos com pior desempenho relativo combinam baixa cadência de reuniões e menor avanço em mecanismos, não apenas perfil financeiro.

**Evidência**
- Matriz comparativa destaca desvios padronizados em reuniões e implementação versus referência geral.
- Segmentos financeiros isolados explicam parte, mas não toda a variância entre grupos.
- Programa Pharus e Davos exibem padrões distintos de cobertura.

**Interpretação:** Comparação entre grupos resume múltiplas dimensões; valores padronizados facilitam leitura relativa, não absoluta.

**Ação recomendada:** Investigar grupos com desvio negativo simultâneo em reuniões e implementação antes de atributos só financeiros.

**Limitações**
- Heatmap usa referência geral do recorte filtrado.
- Grupos pequenos amplificam desvios aparentes.

## Coorte e retenção

**Insight:** Coortes recentes mostram queda de retenção nas primeiras janelas quando marcos iniciais atrasam; retenção melhora após estabilização de cadência.

**Evidência**
- Retenção mês a mês declina mais acentuadamente nas primeiras colunas de vida em coortes recentes.
- Cores mais quentes nas primeiras idades indicam maior perda relativa no snapshot.
- Sobrevivência global reforça diferença entre curvas por segmento quando comparável.

**Interpretação:** Coorte mede permanência sem cancelamento até idade; não confundir com conversão de funil comercial.

**Ação recomendada:** Acompanhar coortes novas com metas explícitas de primeira reunião e implementação nos primeiros meses.

**Limitações**
- Granularidade mensal/trimestral altera leitura fina.
- Cancelamentos sem data confirmada reduzem precisão de evento.

## Matriz geral e relações entre variáveis

**Insight:** A matriz geral confirma cluster de variáveis de jornada (reuniões, implementação, recência) parcialmente independentes de variáveis financeiras.

**Evidência**
- Correlações fortes intra-bloco jornada versus correlações moderadas jornada × financeiro.
- NPS e mecanismos correlacionam entre si, mas com lacunas de cobertura.
- Variáveis de leakage excluídas do ranking preditivo.

**Interpretação:** Relações pairwise não substituem modelo multivariável; matriz é mapa exploratório.

**Ação recomendada:** Usar matriz para hipóteses de combinação, não para priorização automática de ações.

**Limitações**
- Correlação linear/monotônica pode omitir efeitos não lineares.
- Missing data reduz pares comparáveis.

## Variáveis excluídas e cuidados de leakage

**Insight:** Variáveis pós-cancelamento ou derivadas do próprio desfecho foram excluídas; ranking preditivo deve ignorar indicadores com risco de leakage.

**Evidência**
- Lista de excluídas inclui status analítico tardio, datas pós-churn e proxies circulares.
- AUC > 0,80 dispara revisão de leakage no ranking exploratório.
- currentCycle e renewalCount não entram como explicativas do próprio desfecho de renovação.

**Interpretação:** Exclusões protegem interpretação causal, mas reduzem universo de variáveis “fortes” artificialmente.

**Ação recomendada:** Validar manualmente qualquer variável nova antes de incluí-la no ranking preditivo.

**Limitações**
- Regras de exclusão evoluem com novos campos na base.
- Modelo exploratório multivariável permanece amostral e não calibrado para produção.

## Recomendações executivas (7)

1. Priorizar cadência de reuniões e redução de tempo sem contato nos clientes ativos.
2. Garantir realização da primeira reunião e marcos iniciais de implementação nos primeiros meses.
3. Monitorar combinações de baixa reunião + baixa implementação como perfil de risco relativo.
4. Usar NPS e mecanismos como complemento, respeitando cobertura parcial (11,6% e 18,7%).
5. Revisar coortes recentes com queda precoce de retenção antes de atribuir causas financeiras.
6. Tratar ranking preditivo como triagem exploratória, não score operacional definitivo.
7. Documentar ações tomadas separadamente dos achados estatísticos para evitar confundir associação com impacto.

## Conclusão

O principal eixo de risco observado associa-se mais à execução da jornada — primeira reunião, frequência de reuniões, tempo sem contato e implementação — do que a indicadores pontuais de satisfação ou mecanismos isolados. NPS e mecanismos devem ser interpretados com cautela pela cobertura menor no recorte analisado.
