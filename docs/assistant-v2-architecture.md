# Assistente da Jornada V2 — Arquitetura

Primeira etapa do **Assistente da Jornada Analytics QuartaVia V2 / Dash Kids**.

## Decisão arquitetural

| Aspecto | V1 (produção) | V2 (novo) |
|---------|---------------|-----------|
| Runtime | Netlify + n8n webhook | Vercel backend direto |
| LLM | Gemini via workflow n8n | Gemini API server-side |
| Matching | `portal-metric-match.mjs` | `lib/assistant/metric-matcher.mjs` |
| Compute | `metric-executor.mjs` + n8n | Computes oficiais V2 + `extractSnapshot` (Etapa 2) |
| Status | **Intocado** | Implementado nesta etapa |

**V1 continua em produção.** Nenhum arquivo, workflow, webhook ou prompt V1 foi alterado.

**Por que não n8n no V2:** menor latência, menos moving parts, controle total do contexto enviado ao LLM, auth corporativa unificada nas APIs V2, e prova de caminho independente antes de expandir compute.

## Fluxo V1 (referência — somente leitura)

```
Usuário (UI chatbot)
  → POST /api/assistant
  → planSemanticQuery (portal-metric-match + registry)
  → executeMetricQuery (metric-executor)
  → payload estruturado → webhook n8n (analytics-jornada-chat)
  → Gemini no n8n verbaliza resposta
  → UI exibe + histórico local
```

Arquivos V1 mapeados (repo `analytics_jornada_cliente`):

- UI: componentes de chat no portal
- `netlify/functions/assistant.mjs` — endpoint principal
- `assistant-data.mjs` — dados auxiliares
- `portal-metric-catalog.mjs`, `portal-metric-registry.mjs`, `portal-metric-match.mjs`
- `metric-executor.mjs`, `portal-query.mjs`
- Integração n8n: `N8N_CHAT_WEBHOOK_URL`

**Nada disso foi modificado.**

## Fluxo V2 (implementado)

```
Usuário
  → POST /api/assistant  (auth corporativa obrigatória)
  → matching determinístico (metric-matcher)
  → filtros conservadores (filter-parser + Filter Contract)
  → analytics.metric_catalog (REST + cache 10 min)
  → valor: snapshot → cache compute → compute oficial → indisponível
  → context builder (JSON compacto, zero PII)
  → resposta determinística (location/source/value simples) OU Gemini
  → JSON { answer, matched_metrics, intent, filters, meta }
```

## Etapa 2 — Compute fallback

### Prioridade de valor

1. **Snapshot válido** (`used_snapshot=true`, `used_compute=false`)
2. **Cache de compute** por página+filtros (`compute_cache_hit=true`)
3. **Compute oficial** da página (`used_compute=true`)
4. **Indisponível** (`value.reason`: `compute_timeout`, `compute_failed`, etc.)

Somente métricas com `validated_for_v2=true` (49 hoje). Métricas históricas (ex.: `renewal_rate`) podem ser explicadas, mas **não** disparam compute automático.

### Registry / extractor reutilizado

O Assistente **não reimplementa fórmulas**. Reutiliza:

- `metric-snapshot-registry.mjs` → `extractSnapshot(metric, ctx)` (mesma camada do snapshot builder)
- `metric-snapshot-builder.mjs` → context builders por página (agora aceitam filtros)
- Computes oficiais: `computeGeneralDataPayload`, `computeMeetingsPayload`, `computeOnboardingPayload`, `computePatrimonialPlanPayload`, `computeMechanismsPayload`

```
lib/assistant/compute/
  assistant-compute-registry.mjs   # 49 métricas, timeouts, cache TTL, Calendly seletivo
  assistant-compute-runner.mjs       # 1 compute por página, cache, timeout
  assistant-value-extractor.mjs      # snapshot → compute → valor formatado
```

### Compute seletivo (Reuniões)

`computeMeetingsPayload({ includeMeetingTypes: false })` quando a métrica **não** é `top_meeting_types`.

Isso evita a cadeia lenta de Calendly/n8n (~78 s em cenários reais) para KPIs operacionais como `total_meetings` e `attendance_rate`.

### Cache server-side

| Página | TTL |
|--------|-----|
| general, journey, mechanisms, patrimonial_plan | 5 min |
| meetings | 10 min |

Chave: `pageId + filtros normalizados + core|types`.

### Timeouts

| Página | Timeout |
|--------|---------|
| general | 10 s |
| mechanisms, patrimonial_plan | 10 s |
| journey | 15 s |
| meetings | 20 s |

### Filtros em linguagem natural (conservador)

| Padrão | Filtro |
|--------|--------|
| `do EP Nícolas Alves` | `engineer` (match exact/fuzzy nas opções do payload) |
| `do segmento PRIVATE` | `segment` |
| `últimos 30/90 dias`, `6 meses`, `12 meses`, `este ano` | `period` |

**Filter Contract:** KPIs `periodSensitive=false` (ex.: `active_clients`) **não** recebem período — o assistente inclui warning metodológico no contexto/resposta.

Arquivos: `filter-parser.mjs`, `metric-filter-contract.mjs` (usa `page-contracts.mjs`).

### Respostas determinísticas ampliadas (Etapa 2)

Sem Gemini quando:

- `location` / `source` (alta confiança)
- `rule` (fallback se Gemini falhar)
- `value` com valor escalar/chart resumido disponível (ex.: "Temos 1.775 clientes ativos.")
- `most_used_mechanism` com label no contexto

Gemini reservado para explicações, comparações, múltiplas métricas e perguntas abertas.

### Meta da API (Etapa 2)

```json
{
  "used_snapshot": false,
  "used_compute": true,
  "compute_page": "general",
  "compute_cache_hit": false,
  "used_gemini": false,
  "value_source": "compute",
  "timings_ms": {
    "catalogMs": 2,
    "matchMs": 1,
    "snapshotMs": 0,
    "computeMs": 8500,
    "geminiMs": 0,
    "totalMs": 8510
  }
}
```

### Formatação centralizada

`value-formatter.mjs` — percent, currency, days, clients, chart top-5 summary.

### Testes Etapa 2

- `tests/analytics/assistant-compute.test.mjs` — prioridade, cache, timeout, filtros, compute seletivo
- **178 testes** totais no projeto; Gemini mockado no CI
- Manual: `npm run assistant:test "sua pergunta"`

## Etapa 3 — UI do chatbot

- Botão flutuante **Assistente** → drawer lateral (`js/assistant/*`, `css/assistant.css`)
- `authenticatedFetch` → `POST /api/assistant`; histórico local (máx. 8 mensagens enviadas)
- Tag de página + link **Ver em … →** via `page` na resposta
- Debug: `?assistantDebug=1`
- Testes: `tests/ui/assistant-ui.test.mjs`

## Estrutura de arquivos

```
lib/assistant/
  catalog-loader.mjs
  metric-matcher.mjs
  filter-parser.mjs
  metric-filter-contract.mjs
  value-formatter.mjs
  analytics-context-builder.mjs
  assistant-prompt.mjs
  gemini-client.mjs
  assistant-service.mjs
  assistant-handler.mjs
  compute/
    assistant-compute-registry.mjs
    assistant-compute-runner.mjs
    assistant-value-extractor.mjs

lib/data/
  analytics-catalog-assistant-rest.mjs  # SELECT expandido para assistente

api/assistant.js

js/assistant/
  assistant-ui.js
  assistant-state.js
  assistant-api.js
  assistant-renderer.js

css/assistant.css

tests/analytics/
  assistant-matcher.test.mjs
  assistant-handler.test.mjs
  assistant-compute.test.mjs

tests/ui/
  assistant-ui.test.mjs

docs/assistant-v2-architecture.md
```

## Matching

**Normalização:** lowercase, remoção de acentos (`foldSearchText`), trim, remoção de pontuação.

**Sinais:** `metric_id`, `label`, `aliases`, `description`, `page_label`, regras de desambiguação (ex.: ativo vs total, tempo onboarding vs conclusão).

**Intenções (heurística, sem LLM):**

| Intenção | Exemplos de gatilho |
|----------|---------------------|
| `value` | quantos, quanto, taxa, percentual |
| `rule` | como calculam, regra, fórmula |
| `source` | de onde vem, fonte, origem |
| `location` | onde vejo, onde encontro |
| `limitation` | limitação, restrição |
| `comparison` | comparar, versus |
| `general` | fallback |

**Confiança:**

- `MATCH_THRESHOLD = 0.45` — inclui em `matched_metrics`
- `HIGH_CONFIDENCE = 0.65` — respostas determinísticas location/source

**Fora do domínio:** perguntas de investimento/ações não forçam métrica.

## Context builder

Payload típico (~1–1.5 KB por métrica):

```json
{
  "intent": "value",
  "metric": { "metric_id", "label", "page_id", "page_label", "description" },
  "status": { "validated_for_v2", "dash_kids_status", "scope_policy" },
  "value": { "available", "data", "coverage", "sample_size", "generated_at", "warning" },
  "rule": "calculation_summary",
  "population": "population_description",
  "sources": { "systems", "objects" },
  "limitations": [],
  "accepted_filters": []
}
```

**Sem snapshot:** `value.available = false` — assistente explica regra/localização/fonte, não inventa número.

**Proibido no contexto:** listas de clientes, IDs, payloads brutos de dashboard, PII.

## Gemini

| Variável | Uso |
|----------|-----|
| `GEMINI_API_KEY` | Server-side only — nunca frontend, logs, testes CI |
| `GEMINI_MODEL` | Centralizado; fallback `gemini-2.0-flash` |
| `GEMINI_TIMEOUT_MS` | Default 25000 ms |

Endpoint: `generativelanguage.googleapis.com/v1beta` com header `x-goog-api-key`.

**Gemini recebe regra/valor/limitações — não inventa regra nem calcula do zero.**

## Respostas determinísticas (sem Gemini)

Decisão documentada: **location** e **source** com match de alta confiança respondem direto do catálogo (latência ~0 ms de LLM). Demais intenções usam Gemini; se falhar, fallback para regra ou “valor indisponível”.

## Auth e erros

- Sem Bearer corporativo → **401**
- Catálogo indisponível → **503**
- Snapshot vazio → continua (não é erro)
- Gemini indisponível → **200** com fallback determinístico quando possível
- Stack traces nunca expostos ao frontend

## Performance (meta desta etapa)

| Etapa | Objetivo |
|-------|----------|
| matching | ~instantâneo (<20 ms em testes) |
| catálogo | cache 10 min; REST na miss |
| snapshot | 1 query por metric_id matched |
| Gemini | maior latência (timeout 25 s) |

Logs: `request_id`, intent, metric_ids, context_bytes, timings — **sem** JWT, API key ou PII.

## Dash Kids status

- **Sim:** indicador oficial V2
- **Avaliar:** pode explicar; mencionar avaliação quando relevante
- **Recomendação: Não Levar:** não promover espontaneamente
- **null:** referência V1 / não validada V2

## Não implementado (próximas etapas)

- Conversas persistentes no banco
- Streaming / voz
- n8n
- Análise Inteligente executiva
- Linguagem natural avançada para todos os filtros

## Testes

- **47 testes** do assistente (matcher + handler + compute + UI)
- **178 testes** totais no projeto
- CI: Gemini **mockado**
- Manual: `npm run assistant:test "sua pergunta"`

## Segurança

- `GEMINI_API_KEY` exclusivamente server-side
- Auth corporativa @quartavia.com.br
- Zero PII no contexto
- BASE QV somente leitura (catálogo/snapshot usam Business Data/Auth)
- V1 intacto
