---
name: quartavia-analytics-login
description: >-
  Login Google corporativo @quartavia.com.br no Analytics QuartaVia (dash-simplificado):
  OAuth Supabase Auth, validação de domínio, bootAuth, authenticatedFetch, APIs
  requireCorporateAuth, env AUTH_* vs DATA_* vs PHARUS_*, redirect allowlist e
  anti-flicker. Use when adding/fixing auth, Google login, sessão, JWT, logout,
  unauthorizedDomain, auth-config, OAuth redirect, or corporate email validation
  in this project.
---

# Analytics QuartaVia — Login corporativo

Skill de **autenticação** do `dash-simplificado`. Stack: **vanilla JS + Supabase Auth (PKCE)** + APIs Vercel.

Para padrões QuartaVia genéricos, ver também a skill pessoal `corporate-google-login`. **Esta skill é a fonte de verdade deste repo.**

## Arquitetura (3 projetos Supabase)

| Projeto | Env | Uso |
|---|---|---|
| **Auth** | `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_ANON_KEY` | Login Google, JWT, `/auth/v1/user` |
| **BASE QV** | `DATA_SUPABASE_*` | Dashboards read-only (service role server-side) |
| **App Pharus** | `PHARUS_SUPABASE_*` | Mecanismos/eventos read-only |

**Nunca** misturar JWT Auth com BASE QV. **Nunca** expor service role no browser.

## Regras absolutas

1. Domínio permitido: **`quartavia.com.br`** — validação exata após `@`.
2. Usar **`isAllowedCorporateEmail()`** de `js/corporateEmail.mjs` — **nunca** `endsWith("@quartavia.com.br")` no e-mail inteiro (aceita `evilquartavia.com.br`).
3. `redirectTo` = **`resolveOAuthRedirectTo(window.location.origin)`** → `${origin}/`.
4. **Não hardcodar** URL de outro app (ex.: dash-jornada-cliente).
5. `hd` no Google é orientação; segurança real = validação pós-sessão + API.
6. Cache `sessionStorage` (`qv:authAccess`) = **UX anti-flicker**, não autorização.
7. Sem sessão Supabase válida + domínio válido → negar acesso.

## Fluxo frontend

```
DOMContentLoaded
  → bootAuth({ onAuthenticated, onSignedOut })
    → GET /api/auth-config (anon key only)
    → supabase.createClient (PKCE, detectSessionInUrl)
    → getSession → verifyStoredSession → applySession
         domínio inválido → signOut + unauthorizedDomain
         ok → renderPortal + onAuthenticated → startPortal()
  → Google click → signInWithOAuth → redirect Google → volta origin
```

### Estados (`body[data-auth]`)

| Estado | UI |
|---|---|
| `loading` / `initializing` | `#auth-root` — "Verificando acesso" |
| `unauthenticated` | Login Google |
| `authenticating` | Botão "Redirecionando…" |
| `authenticated` | `#portal-root` visível |
| `unauthorizedDomain` | Login + mensagem domínio |
| `error` | Login + retry |

CSS em `css/layout.css`: portal oculto até `data-auth="authenticated"`.

## Arquivos-chave

| Arquivo | Responsabilidade |
|---|---|
| `js/corporateEmail.mjs` | `isAllowedCorporateEmail`, mensagens |
| `js/auth.mjs` | bootAuth, OAuth, cache, authenticatedFetch |
| `index.html` | `#auth-root`, `#portal-root`, botão Google |
| `js/app.js` | `bootAuth` → `startPortal()` |
| `api/auth-config.js` | Expõe URL + anon key (via `buildAuthConfigResult`) |
| `lib/auth.mjs` | `requireCorporateAuth`, `authenticateRequest` (APIs) |
| `lib/env.mjs` | `getAuthEnv`, `CORPORATE_DOMAIN`, validação HTTPS |

Detalhes env/API: [reference.md](reference.md)

## Implementar / corrigir login

### 1. Validação de e-mail

Sempre importar de `js/corporateEmail.mjs` (frontend) ou `lib/auth.mjs` (backend — reexporta a mesma função):

```javascript
import { isAllowedCorporateEmail, INVALID_DOMAIN_MESSAGE } from "./corporateEmail.mjs";

// ✅ correto
isAllowedCorporateEmail("ana@quartavia.com.br"); // true
isAllowedCorporateEmail("x@evilquartavia.com.br"); // false

// ❌ proibido para gate de acesso
email.endsWith("@quartavia.com.br");
```

### 2. OAuth Google

```javascript
await authSupabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: resolveOAuthRedirectTo(window.location.origin),
    queryParams: {
      hd: ALLOWED_GOOGLE_DOMAIN,
      prompt: "select_account",
    },
  },
});
```

Salvar hash pretendido: `sessionStorage qv:intendedHash` antes do redirect.

### 3. Chamadas autenticadas (frontend)

```javascript
import { authenticatedFetch, getAccessToken } from "./auth.mjs";

// Preferir authenticatedFetch — refresh em 401, signOut em 403 domínio
const res = await authenticatedFetch("/api/dashboard?...");
```

Páginas usam `fetchPageJson` → trata `AUTH_REQUIRED`.

### 4. Proteger API (backend)

```javascript
import { requireCorporateAuth } from "../auth.mjs";

export async function handleXRequest(request) {
  const denied = await requireCorporateAuth(request);
  if (denied) return denied;
  // ...
}
```

Retornos padrão:
- `401` + `unauthenticated` — sem token / sessão inválida
- `403` + `invalid_domain` — e-mail fora de `@quartavia.com.br`
- `503` + `config` — env ausente

### 5. Supabase Redirect URLs

Incluir **este app** na allowlist Auth (sem remover apps irmãos):

- `http://localhost:5173/**` (ou porta local usada)
- `https://<dominio-deste-app>.vercel.app/**`

Se `redirectTo` não estiver na lista → GoTrue usa Site URL → redirect errado.

Callback Google Cloud: `https://<auth-project-ref>.supabase.co/auth/v1/callback`

## Anti-flicker (cache UX)

- Chave: `qv:authAccess` — `{ userId, email, authorized: true, checkedAt }`
- Compatível só se `userId` e `email` batem com sessão
- Hidrata portal antes de `verifyStoredSession` em background
- **`TOKEN_REFRESHED`**: atualizar sessão silenciosamente — **não** voltar para loading
- Logout / `SIGNED_OUT` / domínio inválido → `clearAuthCache()`

Ordem mental: **authenticated > loading** — não flicker em refresh de token.

## Erros comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Redirect para outro app | Allowlist / Site URL Supabase | Adicionar origin deste app |
| `AUTH_CONFIG_MISSING` | Env Vercel | `AUTH_SUPABASE_URL` + `AUTH_SUPABASE_ANON_KEY` |
| Service role no browser | Anon key errada | Usar anon; rejeitar service_role em `buildAuthConfigResult` |
| Login ok mas API 403 | Domínio não corporativo | Verificar `isAllowedCorporateEmail` no handler |
| Página "Sessão expirada" | `authenticatedFetch` 401 | Esperado; usuário reloga |
| Flicker "Verificando acesso" | TOKEN_REFRESHED → loading | Manter branch silencioso em `onAuthStateChange` |
| `@quartavia.com.br` em analytics filter | `endsWith` em código de dados | OK para **excluir internos**; **não** usar como gate de login |

## Checklist

- [ ] `isAllowedCorporateEmail` com split `@` e domínio exato
- [ ] `redirectTo` via `resolveOAuthRedirectTo(origin)` — sem hardcode
- [ ] Allowlist Supabase inclui domínio **deste** deploy
- [ ] `/api/auth-config` retorna só anon key (HTTPS)
- [ ] Handlers usam `requireCorporateAuth`
- [ ] Frontend usa `authenticatedFetch` ou `fetchPageJson`
- [ ] Logout limpa `qv:authAccess`
- [ ] `TOKEN_REFRESHED` não reseta UI para loading
- [ ] Testes: domínio válido/inválido; API 401/403

## Testes no repo

- `tests/analytics/analytics-auth-access.test.mjs` — JWT + anon, não service role
- `tests/analytics/statistical-snapshot-auth.test.mjs` — domínio inválido
- Handlers mockam `requireCorporateAuth` nos testes de API

## O que NÃO fazer

- ❌ Usar `DATA_SUPABASE_SERVICE_ROLE_KEY` no browser
- ❌ Validar login com `endsWith` no e-mail
- ❌ Copiar `VITE_SITE_URL` de outro projeto
- ❌ Bypass de auth em handler "só para testar" em produção
- ❌ Armazenar JWT em localStorage custom (Supabase client já persiste)

## Novo endpoint autenticado

1. Handler: `requireCorporateAuth(request)` no início
2. Se precisar RLS analytics: `requireCorporateAuthUser` → repassar `accessToken` ao PostgREST Business Data
3. Frontend: `authenticatedFetch` ou padrão `fetchPageJson`
4. Erro 403 domínio: mensagem `INVALID_DOMAIN_MESSAGE` nas páginas
