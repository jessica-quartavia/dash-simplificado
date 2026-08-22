# Análises Estatísticas — Auditoria Período × Snapshot

POC Etapa 5. Features do snapshot são **fotografia atual** (as-of refresh). Período do filtro da página afeta subconjuntos, não recalcula features históricas.

| Componente | Usa período? | Snapshot suficiente? | Precisa live? | Notas |
|---|---|---|---|---|
| População / filtros (busca, EP, status, programa) | Parcial | Sim | Não | Colunas denormalizadas + JSON features |
| Filtro período (hire/cancel) | Sim | Sim* | Não* | *Filtra por `hireDate`/`cancellationDate` persistidos |
| Matriz de correlação | Não (foto atual) | Sim | Não | Variáveis numéricas/categóricas no registry |
| Cancelamento (univariado) | Não | Sim | Não | |
| Renovação (univariado) | Não | Sim | Não | Universo renewal usa mesmos registros |
| Ranking / health score | Não | Sim | Não | |
| Coorte retenção | Entrada (cohort month) | Sim | Não | `hireDate`, `survivalTime`, `survivalEvent` |
| Curva Kaplan-Meier | Duração até evento | Sim | Não | Survival derivado no build live |
| Descobertas / sinais | Não | Sim | Não | |
| Matrizes por eixo (EP, segmento…) | Não | Sim | Não | |
| Insights por cliente (top N) | Não | Sim | Não | Nome só para UI/busca — PII mínima |
| NPS join / cobertura | Não | Sim | Não | `nps_join` em `statistical_snapshot_runs` |
| Eventos dentro de janela móvel | Sim | **Não** | **Sim** | Não modelado no snapshot POC |
| Reuniões por tipo Calendly | Não usado nesta página | N/A | Não | `includeMeetingTypes: false` no builder |

## Modelo híbrido aceito

Esta POC cobre **~100%** dos componentes atuais de Análises Estatísticas porque o compute já trabalha sobre **client feature records**, não sobre event streams paginados.

Componentes futuros que dependam de séries temporais dentro do período precisarão de:
- colunas adicionais no registry, ou
- fetch live complementar (híbrido).

## Freshness

- TTL POC: **15 minutos** (`STATISTICAL_SNAPSHOT_TTL_MS`)
- Snapshot stale → fallback live (`[StatSnapshot] stale or empty, fallback=live`)
- Flag `STATISTICAL_SNAPSHOT_ENABLED=false` por padrão até fidelity + benchmark aprovados
