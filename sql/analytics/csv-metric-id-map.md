# Mapeamento CSV → metric_id

IDs reutilizados da V1 quando existiam. IDs novos (gráficos da V2 / CSV sem entrada no catálogo antigo) em snake_case.

CSV: `sql/analytics/source/confiabilidade-indicadores-pagina1.csv`

## Dados Gerais (`general`)

| CSV | metric_id | origem |
|---|---|---|
| Cancelados confirmados | `cancelled_clients` | V1 |
| Cancelados sem data confirmada | `cancelled_without_confirmed_date` | V1 |
| Clientes ativos | `active_clients` | V1 |
| Clientes com diagnóstico financeiro | `clients_with_financial_data` | V1 |
| Clientes congelados | `frozen_clients` | V1 |
| Clientes não ativos | `non_active_clients` | V1 |
| Permanência média | `median_stay_days` | V1 (mediana) |
| Renda mensal média | `median_monthly_income` | V1 (mediana) |
| Reserva de liquidez média | `median_liquidity_reserve` | V1 (mediana) |
| Total de clientes | `total_clients` | V1 |
| Último aporte médio | `median_last_contribution` | V1 (mediana) |
| Clientes por segmento | `clients_by_segment` | novo |
| Clientes por status | `clients_by_status` | novo |
| Distribuição da renda mensal | `monthly_income_distribution` | novo |
| Distribuição da reserva de liquidez | `liquidity_reserve_distribution` | novo |
| Engenheiro Patrimonial | `clients_by_engineer` | novo |
| Evolução mensal da aquisição de clientes | `client_acquisition_monthly` | novo |
| Perfil Financeiro | `financial_profile_distribution` | novo |
| Tempo de permanência | `stay_duration_distribution` | novo |

## Jornada e onboarding (`journey`)

| CSV | metric_id | origem |
|---|---|---|
| Mediana onboarding total | `average_onboarding_days` | V1 |
| Mediana até 1ª reunião | `average_days_to_first_meeting` | V1 |
| Mediana até entrega do plano | `average_days_to_plan_delivery` | V1 |
| Mediana até 1º mecanismo | `average_days_to_first_mechanism` | V1 |
| Concluíram onboarding | `completed_onboarding_clients` | V1 |
| Dias até a primeira reunião | `days_to_first_meeting_chart` | novo |
| Dias até entrega do plano patrimonial | `days_to_plan_delivery_chart` | novo |
| Dias até primeiro mecanismo implementado | `days_to_first_mechanism_chart` | novo |
| Tempo total de onboarding | `total_onboarding_time_chart` | novo |
| Concluiu onboarding | `onboarding_completion_chart` | novo |

## Reuniões (`meetings`)

| CSV | metric_id | origem |
|---|---|---|
| Total de reuniões | `total_meetings` | V1 |
| Média de reuniões/mês | `average_meetings_per_month` | V1 |
| Dias desde a última reunião (cartão) | `days_since_latest_meeting` | V1 |
| Intervalo médio entre reuniões (cartão) | `average_interval_between_meetings` | V1 |
| Total de no-shows | `no_show_meetings` | V1 |
| Remarcações | `total_meeting_reschedules` | V1 |
| Taxa de comparecimento | `attendance_rate` | V1 |
| Clientes com reunião | `clients_with_meeting` | V1 |
| Reuniões por mês | `meetings_by_month_chart` | novo |
| Status das reuniões | `meeting_status_chart` | novo |
| Frequência por cliente | `meeting_frequency_chart` | novo |
| Dias desde a última reunião (gráfico) | `days_since_last_meeting_chart` | novo |
| Intervalo médio entre reuniões (gráfico) | `meeting_interval_chart` | novo |
| Frequência de no-show por cliente | `noshow_frequency_chart` | novo |
| Reuniões por tipo | `top_meeting_types` | V1 |
| Reuniões por Engenheiro Patrimonial | `meetings_by_engineer_chart` | novo |

## Plano Patrimonial (`patrimonial_plan`)

| CSV | metric_id | origem |
|---|---|---|
| Plano aprovado | `plan_approved_clients` | V1 |
| Dias até aprovação | `plan_days_to_approval` | V1 |
| Status do plano | `plan_status_chart` | novo |

## Implementação de Mecanismos (`mechanisms`)

| CSV | metric_id | origem |
|---|---|---|
| Clientes com mecanismos — BASE QV | `clients_with_mechanisms` | V1 |
| Tipos de mecanismos | `types_used` | V1 |
| Tipos sem utilização | `types_unused` | V1 |
| Mecanismo mais utilizado | `most_used_mechanism` | V1 |
| Mecanismos implementados | `implemented_mechanisms` | V1 |
| Em andamento | `in_progress_mechanisms` | V1 |
| Percentual implementado | `implementation_rate` | V1 |
| Tempo médio até a primeira implementação | `average_days_to_first_implementation` | V1 |
| Clientes com implementação recente | `clients_with_recent_implementation` | V1 |
| Status dos vínculos | `mechanism_status_chart` | novo |
| Quantidade de mecanismos por cliente | `mechanisms_per_client_chart` | novo |
| Cobertura do catálogo | `catalog_coverage_chart` | novo (V1 tem `catalog_mechanisms` = tipos no catálogo) |
| Utilização por tipo de mecanismo | `mechanism_type_usage_chart` | novo |
| Implementações por mês | `implementations_by_month_chart` | novo |
| Tempo até a primeira implementação | `days_to_first_implementation_chart` | novo |
| Dias desde a última implementação | `days_since_last_implementation_chart` | novo |
| Implementados por segmento | `implemented_by_segment_chart` | novo |
| Clientes com mecanismo implementado por EP | `implemented_by_engineer_chart` | novo |

Métricas da V1 ausentes deste CSV entram no catálogo com `validated_for_v2 = false` e `dash_kids_status` nulo.
