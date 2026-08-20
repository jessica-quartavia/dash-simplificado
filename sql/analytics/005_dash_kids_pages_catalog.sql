-- Incremental/idempotente: Dash Kids — Atualização Financeira, Satisfação, Cancelamento, Renovação.
-- NÃO executar automaticamente. Destino: Business Data.analytics.metric_catalog
-- Fonte de seleção: CSV atualizado (confiabilidade-indicadores - Página1 (2).csv)

INSERT INTO analytics.metric_catalog (
  metric_id, page_id, page_label, label, description, metric_type, unit,
  dash_kids_status, validated_for_v2, scope_policy, population_description,
  calculation_summary, source_systems, source_objects, accepted_filters, aliases,
  limitations, ui_priority, v1_reference, csv_reference, updated_at
) VALUES
('financial_clients_with_data', 'financial_updates', 'Atualização Financeira', 'Clientes com dados financeiros', 'Clientes distintos com ao menos um registro em client_financial_data.', 'card', 'clients', 'Sim', true, 'all_clients', 'Carteira após exclusões operacionais; default UI em ativos.', 'count(distinct client_id) com client_financial_data', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"client_financial_data","column":"client_id"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'primary', 'financial-updates.mjs#clientsWithFinancialData', 'CSV:89.0%', now()),
('financial_post_creation_updates', 'financial_updates', 'Atualização Financeira', 'Clientes com registro alterado após a criação', 'updated_at > created_at; criação inicial não conta.', 'card', 'clients', 'Sim', true, 'all_clients', 'Carteira filtrada.', 'count(clientes com updated_at > created_at)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"client_financial_data","column":"updated_at"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '["Sem histórico de eventos; apenas estado mais recente."]'::jsonb, 'primary', 'financial-updates.mjs#totalFinancialUpdates', 'CSV:66.4%', now()),
('financial_median_days_since_update', 'financial_updates', 'Atualização Financeira', 'Recência média da atualização', 'Mediana de dias desde a última atualização válida (UI pode rotular como recência).', 'card', 'days', 'Sim', true, 'all_clients', 'Clientes com atualização válida.', 'median(daysSinceFinancialUpdate)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"client_financial_data","column":"updated_at"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '["CSV nomeia média; valor principal V1 = mediana."]'::jsonb, 'primary', 'financial-updates.mjs#medianDaysSinceUpdate', 'CSV:66.4%', now()),
('financial_outdated_over_90_days', 'financial_updates', 'Atualização Financeira', 'Clientes com dados desatualizados', 'Mais de 90 dias desde atualização válida.', 'card', 'clients', 'Sim', true, 'all_clients', 'Clientes com registro financeiro.', 'count(daysSinceFinancialUpdate > 90)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"client_financial_data","column":"updated_at"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'primary', 'financial-updates.mjs#outdatedOver90Days', 'CSV:66.4%', now()),
('financial_gear_activation_days', 'financial_updates', 'Atualização Financeira', 'Tempo até ativação das engrenagens', 'Dias entre primeira client_financial_data.created_at e primeira reunião Ativação das Engrenagens em/após essa data.', 'card', 'days', 'Sim', true, 'all_clients', 'Clientes com ambas as fontes.', 'median(days financial → activation meeting)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"client_meetings","column":"start_time"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'secondary', 'financial-updates.mjs#financialToActivation', 'CSV:84.3%', now()),
('nps_official_index', 'satisfaction', 'Pesquisa de Satisfação', 'NPS', 'Última resposta válida por cliente; % promotores − % detratores.', 'card', 'index', 'Sim', true, 'respondents', 'Respondentes NPS sobre carteira.', 'calcNps(latest per client by created_at)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"nps_responses","column":"score"}]'::jsonb, '["search","engineer","program"]'::jsonb, '[]'::jsonb, '["Cobertura ~28% sobre carteira."]'::jsonb, 'primary', 'satisfaction.mjs#nps', 'CSV:28%', now()),
('csat_average', 'satisfaction', 'Pesquisa de Satisfação', 'CSAT médio', 'Média de csat_responses.score (tipo CSAT).', 'card', 'score', 'Sim', true, 'respondents', 'Respondentes CSAT.', 'average(csat score)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"csat_responses","column":"score"}]'::jsonb, '["search","engineer","program"]'::jsonb, '[]'::jsonb, '["Denominador indisponível em parte dos recortes."]'::jsonb, 'primary', 'satisfaction.mjs#csatAverage', 'CSV:denominador indisponível', now()),
('total_cancellations', 'cancellations', 'Cancelamento', 'Cancelamentos efetivados', 'Mesma regra consolidada de Dados Gerais (churn/distrato/data_churn).', 'card', 'clients', 'Sim', true, 'cancellation_process', 'Universo de cancelamento/processo.', 'count(distinct efetivados analíticos)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"cancellations","column":"churn_efetivado_at"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '["Equalizar com Dados Gerais."]'::jsonb, 'primary', 'analytical-cancellation.mjs', 'CSV:74.4%', now()),
('cancellation_intentions', 'cancellations', 'Cancelamento', 'Intenções/pedidos de cancelamento', 'Processo operacional; não efetiva cancelamento analítico.', 'card', 'clients', 'Avaliar - mas levar', true, 'cancellation_process', 'Linhas não arquivadas em processo.', 'count(intenção/pedido)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"cancellations","column":"data_pedido"}]'::jsonb, '["search","status","engineer","segment","program"]'::jsonb, '[]'::jsonb, '["Cobertura/qualidade variável."]'::jsonb, 'secondary', 'cancellation-process.mjs', 'CSV:Avaliar - mas levar', now()),
('renewal_rate', 'renewal', 'Renovação', 'Renovaram', 'Clientes com clients.ciclo > 1.', 'card', 'clients', 'Sim', true, 'renewal_eligible', 'Clientes com ciclo válido ≥ 1.', 'count(ciclo > 1)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"clients","column":"ciclo"}]'::jsonb, '["search","engineer","segment","program"]'::jsonb, '[]'::jsonb, '["Inferência por ciclo; sem evento formal de renovação."]'::jsonb, 'primary', 'client-cycle-renewal.mjs', 'CSV:98.9%', now()),
('total_renewals', 'renewal', 'Renovação', 'Quantidade de renovações', 'sum(max(ciclo - 1, 0)) sobre elegíveis.', 'card', 'count', 'Sim', true, 'renewal_eligible', 'Clientes com ciclo válido.', 'sum(ciclo - 1)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"clients","column":"ciclo"}]'::jsonb, '["search","engineer","segment","program"]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'primary', 'client-cycle-renewal.mjs', 'CSV:98.9%', now()),
('max_current_cycle', 'renewal', 'Renovação', 'Maior ciclo atual', 'max(ciclo) entre elegíveis.', 'card', 'cycle', 'Sim', true, 'renewal_eligible', 'Clientes com ciclo válido.', 'max(ciclo)', '["BASE QV"]'::jsonb, '[{"system":"BASE QV","schema":"public","object":"clients","column":"ciclo"}]'::jsonb, '["search","engineer","segment","program"]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'primary', 'client-cycle-renewal.mjs', 'CSV:98.9%', now())
ON CONFLICT (metric_id) DO UPDATE SET
  page_id = EXCLUDED.page_id,
  page_label = EXCLUDED.page_label,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  metric_type = EXCLUDED.metric_type,
  unit = EXCLUDED.unit,
  dash_kids_status = EXCLUDED.dash_kids_status,
  validated_for_v2 = EXCLUDED.validated_for_v2,
  scope_policy = EXCLUDED.scope_policy,
  population_description = EXCLUDED.population_description,
  calculation_summary = EXCLUDED.calculation_summary,
  source_systems = EXCLUDED.source_systems,
  source_objects = EXCLUDED.source_objects,
  accepted_filters = EXCLUDED.accepted_filters,
  aliases = EXCLUDED.aliases,
  limitations = EXCLUDED.limitations,
  ui_priority = EXCLUDED.ui_priority,
  v1_reference = EXCLUDED.v1_reference,
  csv_reference = EXCLUDED.csv_reference,
  updated_at = EXCLUDED.updated_at;

-- Ocultar métricas explicitamente não levadas nesta V2
UPDATE analytics.metric_catalog
SET validated_for_v2 = false, ui_priority = 'hidden', updated_at = now()
WHERE metric_id IN (
  'average_days_to_cancellation',
  'renewal_time_to_renew',
  'renewal_on_time',
  'renewal_value'
);
