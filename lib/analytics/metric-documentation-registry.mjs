/**
 * Conteúdo determinístico da Documentação de Métricas.
 *
 * Este módulo não consulta APIs e não calcula indicadores. Ele descreve, em
 * linguagem simples, as regras oficiais já usadas pelo Analytics V2 e pode ser
 * importado futuramente pelo Assistente sem depender do DOM.
 */

export const METRIC_DOCUMENTATION_STATUSES = Object.freeze({
  OFFICIAL: "Oficial",
  VALIDATING: "Em validação",
  EXPERIMENTAL: "Experimental",
});

export const METRIC_DOCUMENTATION_SECTIONS = Object.freeze([
  { id: "clients", label: "Clientes e carteira", shortLabel: "Clientes", open: true },
  { id: "cancellation", label: "Cancelamento", shortLabel: "Cancelamento", open: true },
  { id: "meetings", label: "Reuniões", shortLabel: "Reuniões" },
  { id: "mechanisms", label: "Mecanismos", shortLabel: "Mecanismos" },
  { id: "financial", label: "Financeiro", shortLabel: "Financeiro" },
  { id: "satisfaction", label: "NPS e CSAT", shortLabel: "Satisfação" },
  { id: "renewal", label: "Renovação", shortLabel: "Renovação" },
  { id: "platform", label: "Uso da plataforma", shortLabel: "Plataforma" },
  { id: "temporal", label: "Indicadores temporais", shortLabel: "Temporal" },
  { id: "support", label: "Atendimento e acionamentos", shortLabel: "Atendimento" },
  { id: "ep", label: "Performance por EP", shortLabel: "EP" },
  { id: "statistics", label: "Análises estatísticas", shortLabel: "Estatística" },
  { id: "health", label: "Health Score", shortLabel: "Health Score" },
  { id: "executive", label: "Resumo Executivo", shortLabel: "Executive" },
]);

const O = METRIC_DOCUMENTATION_STATUSES.OFFICIAL;
const V = METRIC_DOCUMENTATION_STATUSES.VALIDATING;
const E = METRIC_DOCUMENTATION_STATUSES.EXPERIMENTAL;

const metric = (id, section, title, meaning, rule, why, example, source, status = O, extra = {}) =>
  Object.freeze({ id, section, title, meaning, rule, why, example, source, status, ...extra });

export const METRIC_DOCUMENTATION = Object.freeze([
  metric("active-client", "clients", "Cliente ativo", "É um cliente que ainda faz parte da carteira.", "Contamos quem tem status analítico Ativo. Um cancelamento efetivo tira o cliente da base ativa, e clientes congelados não entram.", "O status escrito no cadastro pode estar atrasado. Os sinais confirmados de cancelamento evitam que alguém já cancelado seja contado como ativo.", "Se João aparece como Ativo, mas já tem distrato assinado, ele não entra como cliente ativo.", "BASE QV", O, { ruleKeys: ["analyticalStatus", "effectiveCancellation"] }),
  metric("analytical-status", "clients", "Status analítico", "É o status confiável que o dashboard usa para organizar a carteira.", "Primeiro verificamos se existe cancelamento efetivo. Se não existir, usamos o status do cadastro: Ativo, Congelado ou uma situação sem confirmação.", "Assim o dashboard não depende apenas de um campo que pode não ter sido atualizado.", "Um cadastro escrito como Cancelado, mas sem nenhuma confirmação, fica separado de um cancelamento efetivo.", "BASE QV"),
  metric("program", "clients", "Programa", "Mostra se o cliente pertence ao Pharus ou ao Davos.", "Usamos o programa informado no cadastro do cliente na BASE QV. Não adivinhamos o programa pela origem de outro dado.", "Uma mesma fonte pode ter pessoas de programas diferentes. O cadastro do cliente é a referência segura.", "Se a BASE QV diz Davos, o cliente aparece como Davos mesmo que outro registro venha do App Pharus.", "BASE QV"),
  metric("tenure", "clients", "Tempo de permanência", "Mostra há quanto tempo o cliente está ou esteve na carteira.", "Para ativos e congelados, contamos da contratação até hoje. Para cancelados com data válida, contamos até o cancelamento. Sem datas suficientes, mostramos Não informado. O indicador oficial ainda aplica um ajuste de 365 dias quando o ciclo mostra renovação, mas a permanência cronológica usada em análises de tempo não recebe esse ajuste.", "Clientes ativos e cancelados precisam de datas finais diferentes. O ajuste evita que um ciclo renovado pareça ter menos de um ano por falta da data do primeiro ciclo.", "Contratado há 200 dias e já no ciclo 2: o indicador de permanência mostra 565 dias; a linha do tempo real continua com 200 dias.", "BASE QV"),

  metric("effective-cancellation", "cancellation", "Cancelamento efetivo", "É um cancelamento que já tem uma confirmação real.", "Verificamos, nesta ordem: data de churn efetivado; data do distrato assinado; distrato escrito exatamente como Assinado; e data de churn no cadastro do cliente.", "O banco pode guardar a confirmação em lugares diferentes. Olhar todos eles evita perder cancelamentos e contar o mesmo cliente duas vezes.", "Se não há data de churn, mas o distrato está assinado, o cliente já é considerado cancelado.", "BASE QV", O, { ruleKeys: ["churn_efetivado_at", "distrato_assinado_at", "distrato", "clients.data_churn"] }),
  metric("cancellation-date", "cancellation", "Data do cancelamento", "É a data usada para dizer quando o cancelamento aconteceu.", "Usamos primeiro a data de churn efetivado. Se ela faltar, usamos a data do distrato assinado. Se também faltar, usamos a data de churn do cadastro.", "Às vezes há mais de uma data para o mesmo caso. Uma ordem única mantém todas as páginas coerentes.", "Se existem datas em 10 e 12 de maio, e 10 de maio é a data de churn efetivado, usamos 10 de maio.", "BASE QV"),
  metric("cancellation-intention", "cancellation", "Intenção de cancelamento", "É um sinal de que o cliente pensa em cancelar, mas ainda não cancelou.", "A intenção é acompanhada separadamente e não tira o cliente da carteira ativa.", "Pensar em cancelar não é o mesmo que concluir o cancelamento.", "Maria registrou uma intenção, mas continuou cliente. Ela segue ativa até existir confirmação.", "BASE QV"),
  metric("cancellation-request", "cancellation", "Pedido de cancelamento", "É quando o cliente já pediu o cancelamento, mas o processo pode não estar concluído.", "O pedido fica separado do cancelamento efetivo e, sozinho, não muda o status analítico para cancelado.", "Isso mostra a etapa do processo sem antecipar um resultado que ainda pode mudar.", "Um pedido feito hoje entra no acompanhamento do processo, mas não no total de churn confirmado.", "BASE QV"),

  metric("total-meetings", "meetings", "Total de reuniões", "É a quantidade de reuniões válidas dos clientes.", "A fonte principal é a BASE QV. Somamos as reuniões da base e apenas as reuniões manuais que não sejam cópias da mesma reunião. Reuniões anteriores à entrada do cliente e duplicadas não entram. Calendly é usado somente no gráfico Reuniões por tipo.", "A mesma reunião pode aparecer na base e no cadastro manual. Retirar a cópia impede contar duas vezes.", "Uma reunião na base e outra manual no mesmo dia e horário contam como uma só.", "BASE QV", O, { ruleKeys: ["client_meetings", "manual_meetings_exclusive"] }),
  metric("clients-without-meeting", "meetings", "Clientes sem reunião", "São clientes que não têm nenhuma reunião válida no recorte escolhido.", "Contamos os clientes da população atual cujo total oficial de reuniões é zero.", "Uma reunião futura, inválida ou anterior à entrada não deve fazer parecer que o cliente já foi atendido.", "Se Ana só tem uma reunião marcada para amanhã, hoje ela ainda aparece como sem reunião realizada.", "BASE QV"),
  metric("days-since-last-meeting", "meetings", "Dias desde a última reunião", "Mostra quantos dias se passaram desde a reunião válida mais recente.", "Encontramos a última reunião válida do cliente e contamos os dias até hoje.", "A medida ajuda a enxergar há quanto tempo o cliente está sem contato.", "Se a última reunião foi há 20 dias, o indicador mostra 20 dias.", "BASE QV"),
  metric("meeting-interval", "meetings", "Intervalo entre reuniões", "Mostra quanto tempo costuma passar entre uma reunião e outra.", "Calculamos os dias entre reuniões válidas do mesmo cliente e resumimos esses intervalos.", "Olhar o intervalo ajuda a entender a regularidade dos encontros, não apenas a quantidade total.", "Reuniões nos dias 1 e 31 têm intervalo de 30 dias.", "BASE QV"),
  metric("no-show", "meetings", "No-show", "É uma reunião em que o cliente não compareceu.", "Só contamos faltas confirmadas. Reuniões futuras e reuniões canceladas não entram nessa conta.", "Não faz sentido marcar falta antes da hora da reunião nem em um encontro que foi cancelado.", "Uma reunião de amanhã não é no-show; uma reunião passada marcada como Não compareceu é.", "BASE QV"),

  metric("has-mechanism", "mechanisms", "Possui mecanismo", "Responde apenas Sim ou Não: o cliente tem pelo menos um mecanismo?", "Se existe ao menos um vínculo de mecanismo, a resposta é Sim. A quantidade não muda essa resposta.", "No Health Score e em algumas análises, importa a presença do mecanismo, não quantos existem.", "Um cliente com 1 mecanismo e outro com 4 respondem Sim.", "BASE QV", O, { ruleKeys: ["hasMechanism"] }),
  metric("implemented-mechanism", "mechanisms", "Mecanismo implementado", "É um mecanismo que chegou ao estado tratado como concluído pelo projeto.", "Na BASE QV, Concluído conta como implementado. No App Pharus, o status suggested é tratado como implementado pela regra atual.", "Cada fonte escreve o andamento de um jeito. A tradução oficial deixa as duas comparáveis.", "Um mecanismo com status Concluído na BASE QV entra como implementado.", "BASE QV e App Pharus"),
  metric("implementation-rate", "mechanisms", "% de clientes com implementação", "Mostra a parte dos clientes que tem pelo menos um mecanismo implementado.", "Dividimos clientes únicos com mecanismo implementado pela população de clientes do recorte e multiplicamos por 100.", "Contar clientes, e não linhas de mecanismos, evita que quem tem muitos mecanismos pese mais.", "Se 4 de 10 clientes têm implementação, o resultado é 40%.", "BASE QV"),

  metric("financial-updated", "financial", "Dado financeiro atualizado", "Mostra se alguém voltou ao registro financeiro depois que ele foi criado.", "Conta como atualizado quando a data de atualização é posterior à data de criação.", "Criar o registro pela primeira vez não significa que houve uma atualização depois.", "Criado segunda e alterado sexta: atualizado. Criado e salvo sem mudança no mesmo instante: não atualizado.", "BASE QV"),
  metric("days-since-financial-update", "financial", "Dias desde a última atualização", "Mostra há quantos dias o dado financeiro foi alterado de verdade.", "Usamos a atualização válida mais recente e contamos os dias até hoje.", "Isso ajuda a separar informações recentes de informações que podem estar antigas.", "Atualizado há 12 dias: o indicador mostra 12 dias.", "BASE QV"),
  metric("monthly-financial-updates", "financial", "Atualizações financeiras mensais", "Mostra a quantidade de clientes com registro financeiro alterado no mês.", "A regra atual conta clientes cuja data de atualização é posterior à criação. A base guarda o estado mais recente, não um histórico completo de todas as alterações.", "Sem um histórico completo, uma pessoa pode ter atualizado várias vezes e ainda aparecer apenas uma vez.", "Três mudanças do mesmo cliente podem aparecer como um cliente atualizado, não como três eventos.", "BASE QV", V),

  metric("nps", "satisfaction", "NPS", "Mostra como os clientes avaliam a experiência em uma nota de 0 a 10.", "Notas 9 e 10 são Promotores; 7 e 8 são Neutros; 0 a 6 são Detratores. NPS = (Promotores − Detratores) ÷ respostas válidas × 100. Usamos a última resposta válida de cada cliente no recorte. O NPS Total é calculado com todas as respostas e não é a média entre Pharus e Davos.", "Promotores puxam o índice para cima e detratores para baixo. Neutros entram no total, mas não são somados nem subtraídos.", "Com 10 respostas, 7 promotores e 2 detratores: (7 − 2) ÷ 10 × 100 = 50.", "BASE QV", V, { ruleKeys: ["npsFormula", "latestValidResponse", "programFromBaseQv"] }),
  metric("csat", "satisfaction", "CSAT", "Mostra a satisfação com uma experiência específica, em notas de 1 a 5.", "Usamos respostas válidas no recorte e calculamos a média das notas. Na classificação atual, nota 5 é Satisfeito e notas de 1 a 4 são Não satisfeito.", "O CSAT olha uma experiência mais pontual que o NPS.", "Notas 5, 4 e 3 têm média 4; uma delas entra como Satisfeito na divisão atual.", "BASE QV", V),

  metric("renewed-client", "renewal", "Cliente renovado", "É um cliente que já passou do primeiro ciclo.", "Consideramos renovado quando o ciclo atual é 2 ou maior.", "O banco tem o ciclo atual, mas não um evento separado de renovação.", "Ciclo 1: ainda não renovou. Ciclo 2: já renovou.", "BASE QV"),
  metric("renewal-count", "renewal", "Quantidade de renovações", "Mostra quantas vezes o cliente já avançou para um novo ciclo.", "Quantidade = maior valor entre ciclo atual menos 1 e zero.", "O primeiro ciclo é a contratação inicial, por isso não conta como renovação.", "Ciclo 1 = 0; ciclo 2 = 1; ciclo 3 = 2 renovações.", "BASE QV", O, { ruleKeys: ["renewalCount=max(currentCycle-1,0)"] }),
  metric("active-renewal-rate", "renewal", "Renovações por clientes ativos", "Mostra a parte dos clientes ativos que já renovou pelo menos uma vez.", "Dividimos clientes analiticamente ativos com ciclo 2 ou maior por todos os clientes analiticamente ativos e multiplicamos por 100.", "A conta mede clientes renovados, não a soma de todas as renovações.", "3 clientes ativos renovaram em uma base de 10 ativos: 30%.", "BASE QV"),

  metric("platform-users", "platform", "Usuários App Pharus", "É a população de usuários considerada na página de uso.", "Usamos o diretório do App Pharus e retiramos usuários corporativos e de demonstração quando eles podem ser identificados.", "Contas internas e de teste não representam uso real de clientes.", "Uma conta @quartavia.com.br não entra na população de clientes.", "App Pharus", V),
  metric("platform-logins", "platform", "Logins", "É a quantidade de acessos bem-sucedidos registrados.", "Contamos os eventos de login aceitos na fonte oficial para cada usuário elegível.", "Um mesmo usuário pode acessar muitas vezes, então usuários e logins são números diferentes.", "Uma pessoa que entrou 4 vezes representa 1 usuário e 4 logins.", "App Pharus", V),
  metric("days-since-access", "platform", "Dias desde o último acesso", "Mostra há quantos dias o usuário fez seu login mais recente.", "Pegamos o último dia com login e contamos até hoje. O resumo da página usa a mediana e retira valores muito fora do normal.", "Valores extremos podem distorcer o retrato do grupo.", "Último login há 8 dias: o usuário mostra 8 dias.", "App Pharus", V),
  metric("login-frequency", "platform", "Frequência de login", "Mostra com que regularidade o usuário entra na plataforma.", "Dividimos o total de logins pelo número de semanas ou meses desde o primeiro acesso.", "A conta torna comparáveis usuários antigos e novos.", "12 logins em 3 meses dão frequência média de 4 logins por mês.", "App Pharus", V),

  metric("temporal-signals", "temporal", "Sinais antes do cancelamento", "Procura sinais que costumam aparecer antes de um cancelamento.", "Comparamos reuniões, tempo sem reunião, mecanismo, atualização financeira, NPS e atividade em janelas anteriores ao cancelamento.", "A comparação ajuda a encontrar padrões que merecem atenção. Associação não significa causa: se um sinal aparece mais entre cancelados, isso não quer dizer que ele sozinho causou o cancelamento.", "Clientes cancelados podem ter passado mais tempo sem reunião, mas isso não prova que a falta de reunião foi a única causa.", "BASE QV e App Pharus"),

  metric("support-total", "support", "Total de acionamentos", "É a quantidade de pedidos de atendimento válidos.", "Retiramos somente registros cujo título, depois de limpar espaços e acentos, seja exatamente teste.", "Assim eliminamos registros de teste sem apagar chamados verdadeiros que apenas mencionam essa palavra.", "Teste é excluído; Teste de acesso do cliente continua na contagem.", "Business Data"),
  metric("support-identified", "support", "Clientes identificados na BASE QV", "Conta clientes ligados com segurança a um cadastro da BASE QV.", "Só contamos quando há uma ligação segura com o cliente. Um nome ou e-mail externo sozinho não é confirmação.", "Pessoas diferentes podem ter nomes parecidos, e um e-mail pode aparecer sem vínculo confiável.", "Um chamado com nome Maria, mas sem vínculo confirmado, não aumenta o total de clientes identificados.", "Business Data e BASE QV"),

  metric("ep-performance", "ep", "Performance por EP", "Compara os indicadores dos clientes de cada Engenheiro Patrimonial.", "A página reutiliza os mesmos cálculos oficiais de reuniões, mecanismos, NPS, renovação e demais páginas. Não cria uma segunda fórmula.", "Se cada página calculasse de um jeito, o mesmo cliente poderia gerar resultados diferentes.", "A renovação mostrada para um EP segue a mesma regra de ciclo usada na página Renovação.", "BASE QV"),

  metric("association", "statistics", "Associação", "Mostra se duas coisas costumam variar juntas.", "Comparamos os valores disponíveis e medimos se eles aparecem juntos com alguma frequência.", "Ajuda a encontrar relações que merecem estudo.", "Mais reuniões e maior permanência podem aparecer juntas, sem que uma seja necessariamente a causa da outra.", "BASE QV e App Pharus"),
  metric("coverage", "statistics", "Cobertura", "Mostra quanto da base tem informação suficiente para uma análise.", "Dividimos os clientes com dado válido pelo total de clientes que poderiam entrar na análise.", "Uma conclusão com pouca informação precisa ser lida com mais cuidado.", "Se 20 de 100 clientes têm NPS, a cobertura é 20%.", "BASE QV e App Pharus"),
  metric("auc", "statistics", "AUC", "Ajuda a medir se uma variável consegue separar melhor clientes ativos e cancelados.", "O resultado resume essa capacidade de separação; quanto mais útil o sinal, melhor ele distingue os dois grupos.", "É uma pista de utilidade, não uma prova de causa nem uma previsão perfeita.", "Um sinal alto entre cancelados e baixo entre ativos pode separar os grupos melhor.", "BASE QV e App Pharus"),
  metric("median", "statistics", "Mediana", "É o valor que fica no meio quando colocamos os números em ordem.", "Ordenamos os valores e pegamos o centro.", "Ela sofre menos com valores muito fora do normal.", "Em 2, 3 e 100, a mediana é 3.", "BASE QV e App Pharus"),
  metric("causality", "statistics", "Causalidade", "É a ideia de que uma coisa realmente provocou outra.", "Estas análises encontram relações nos dados. Elas não provam que uma coisa causou a outra.", "Duas coisas podem aparecer juntas por vários motivos que o dashboard não observa.", "Poucas reuniões podem aparecer junto do churn, mas isso sozinho não prova a causa do cancelamento.", "BASE QV e App Pharus"),

  metric("health-components", "health", "Variáveis do Health Score", "A nota experimental usa somente engajamento por reuniões e se o cliente possui mecanismo.", "Reuniões viram um score de 0 a 100 conforme a posição do cliente no grupo. Possui mecanismo vale 100 para Sim e 0 para Não. A quantidade de mecanismos não é usada.", "Poucas variáveis deixam o teste fácil de entender e ajustar.", "Dois mecanismos não valem mais que um: os dois casos respondem apenas Sim.", "BASE QV", E, { components: ["meetingCount", "hasMechanism"] }),
  metric("health-weights", "health", "Pesos do Health Score", "Os pesos dizem quanto cada variável influencia a nota.", "Os dois pesos sempre completam 100%. O padrão atual é 50% para reuniões e 50% para mecanismo, e pode ser simulado na tela.", "Mudar os pesos ajuda a testar diferentes formas de olhar a saúde do cliente.", "70% reuniões e 30% mecanismo dá mais influência às reuniões.", "Analytics V2", E),
  metric("health-score", "health", "Score de saúde", "É uma nota experimental que junta os dois sinais do Health Score.", "Health Score = score de reuniões × peso de reuniões + score de mecanismo × peso de mecanismo. Cliente sem reunião e sem mecanismo fica Sem dados.", "O Health Score serve para testar formas de acompanhar a saúde dos clientes. Ele ainda não é uma previsão definitiva de cancelamento.", "Reuniões 80 com peso 50% e mecanismo 100 com peso 50% resultam em 90.", "Analytics V2", E, { formula: "meetingScore * meetingWeight + mechanismScore * mechanismWeight" }),

  metric("executive-summary", "executive", "Métricas do Resumo Executivo", "O Resumo Executivo não cria métricas novas. Ele reúne os principais números das outras páginas.", "Cada indicador aponta para sua página e regra oficial: NPS vem de Satisfação, reuniões de Reuniões, mecanismos de Mecanismos e renovação de Renovação.", "Compartilhar a mesma regra evita números diferentes para a mesma pergunta.", "O NPS do Executive é o mesmo NPS da Pesquisa de Satisfação no mesmo recorte.", "Analytics V2", O, { sharedRules: ["nps", "total-meetings", "implementation-rate", "active-renewal-rate"] }),
]);

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function searchMetricDocumentation(query, metrics = METRIC_DOCUMENTATION) {
  const term = fold(query);
  if (!term) return [...metrics];
  return metrics.filter((item) =>
    [item.title, item.meaning, item.rule, item.why, item.example, item.source]
      .some((value) => fold(value).includes(term)),
  );
}

export function metricDocumentationSummary(metrics = METRIC_DOCUMENTATION) {
  const statuses = {};
  for (const item of metrics) statuses[item.status] = (statuses[item.status] || 0) + 1;
  return {
    metrics: metrics.length,
    sections: new Set(metrics.map((item) => item.section)).size,
    statuses,
  };
}

export function getMetricDocumentationById(id) {
  return METRIC_DOCUMENTATION.find((item) => item.id === id) || null;
}
