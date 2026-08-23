# Temporal Indicators — Fidelity Audit

Gerado em: 2026-08-23T00:50:23.548Z

## Comparação card por card

| Card | V1 | V2 antes | V2 depois | Delta | Status | Causa |
|---|---:|---:|---:|---:|---|---|
| Clientes/usuários | 3428 | 3428 | 3878 | 450 | FAIL | — |
| Logins | 0 | 5415 | 5415 | 5415 | FAIL | Fonte ou filtro demo divergente |
| Reuniões | 6977 | 6980 | 6977 | 0 | PASS | V2 usava analytics-data-context com order id.asc (canônico). V1 usa start_time.asc. Mesma regra de dedupe; população de entrada diferia em 3 linhas. |
| Implementações | 1086 | 1086 | 1086 | 0 | PASS | Card omitido na UI V2 (compute já correto) |
| Atualizações financeiras | 3060 | 3060 | 3060 | 0 | PASS | — |
| NPS | 292 | 292 | 292 | 0 | PASS | — |
| Interações | Sem dado | Sem dado | Sem dado | — | PASS | — |
| Dias sem atividade | 70.8 | 65.4 | 65.4 | -5.3999999999999915 | FAIL | — |

## Clientes/Usuários (cross-source)

- BASE QV: 3428
- App Pharus users (logins): 0
- Matched (overlap): 0
- App-only subjects: 0
- Union total: 3428
- Fórmula: base + appOnly = 3428+0 = 3428
- Crosswalk: linked_user_id, cpf_digits, email, phone_digits (match exato, sem fuzzy)

## Logins

- Regra V1: metrics.events, event_name ∈ {login_succeeded, login_success}, janela 12m
- V2 source: analytics.platform_login_events
- Correção: fallback analytics.platform_login_events (sem coluna metadata)

## Reuniões — diagnóstico dos 3 registros

1. client_id=`4ce91525-89a3-42e0-8986-6b1f085e3b33` start=`2026-06-25T16:00:00+00:00` source=client_meetings event=`Rota Patrimonial | QV`
   - reason_in_v2: AnalyticsDataContext reordena fetch para id.asc → conjunto completo (7603 ids únicos)
   - reason_excluded_v1: Paginação PostgREST com order start_time.asc perde 3 ids (7600 únicos) por colisão de offset
2. client_id=`e4ef5eac-3581-482e-bed3-a89e1486d5df` start=`2026-04-27T19:00:00+00:00` source=client_meetings event=`Ativação das Engrenagens | QV`
   - reason_in_v2: AnalyticsDataContext reordena fetch para id.asc → conjunto completo (7603 ids únicos)
   - reason_excluded_v1: Paginação PostgREST com order start_time.asc perde 3 ids (7600 únicos) por colisão de offset
3. client_id=`7a9362e1-546d-4765-bf6f-6111480df87b` start=`2026-04-27T19:00:00+00:00` source=client_meetings event=`Checkpoint 1 | QV`
   - reason_in_v2: AnalyticsDataContext reordena fetch para id.asc → conjunto completo (7603 ids únicos)
   - reason_excluded_v1: Paginação PostgREST com order start_time.asc perde 3 ids (7600 únicos) por colisão de offset

## Filtros por card

```json
{
  "clients_users": [
    "search",
    "program",
    "source"
  ],
  "logins": [],
  "meetings": [],
  "implementations": [],
  "financial": [],
  "nps": [],
  "interactions": [],
  "inactivity": [],
  "recency_table": [
    "search",
    "program",
    "source",
    "month"
  ],
  "pre_cancellation": [
    "cancelWindow"
  ]
}
```

## Testes

```json
{
  "clients_users": {
    "status": "FAIL",
    "v1": 3428,
    "v2": 3878
  },
  "logins": {
    "status": "FAIL",
    "v1": 0,
    "v2": 5415
  },
  "meetings": {
    "status": "PASS",
    "v1": 6977,
    "v2": 6977
  },
  "implementations": {
    "status": "PASS",
    "v1": 1086,
    "v2": 1086
  },
  "financial": {
    "status": "PASS",
    "v1": 3060,
    "v2": 3060
  },
  "nps": {
    "status": "PASS",
    "v1": 292,
    "v2": 292
  },
  "interactions": {
    "status": "PASS",
    "v1": "Sem dado",
    "v2": "Sem dado"
  },
  "inactivity": {
    "status": "FAIL",
    "v1": 70.8,
    "v2": 65.4
  }
}
```