-- Incremental: páginas EP / Temporal / Estatística (NÃO EXECUTAR automaticamente)
-- validated_for_v2 = true somente para métricas implementadas nesta etapa.
-- dash_kids_status permanece NULL nas 3 páginas (CSV não classifica estas páginas).

UPDATE analytics.metric_catalog
SET validated_for_v2 = true,
    updated_at = now()
WHERE page_id = 'ep_performance'
  AND metric_id IN (
    'ep_clients_by_advisor',
    'ep_meeting_coverage',
    'ep_clients_without_meeting',
    'ep_cancelled_share',
    'ep_nps',
    'ep_small_samples'
  );

UPDATE analytics.metric_catalog
SET validated_for_v2 = true,
    updated_at = now()
WHERE page_id = 'temporal_indicators'
  AND metric_id IN (
    'temporal_total_subjects',
    'temporal_financial_updates',
    'temporal_active_with_signals'
  );

UPDATE analytics.metric_catalog
SET validated_for_v2 = true,
    updated_at = now()
WHERE page_id = 'statistical_crosses'
  AND metric_id IN (
    'sc_active_clients',
    'sc_confirmed_cancellations',
    'sc_discoveries',
    'sc_correlation_matrix',
    'sc_survival',
    'sc_cohort',
    'sc_auc',
    'sc_top_association',
    'sc_income_diff',
    'sc_excluded_variables'
  );

-- Divergência registrada: CSV mais recente (Downloads Página1 (2).csv, 2026-08-20)
-- não contém linhas para Performance EP, Indicadores Temporais ou Análises Estatísticas.
-- Classificações Dash Kids destas páginas permanecem pendentes de atualização do CSV.
