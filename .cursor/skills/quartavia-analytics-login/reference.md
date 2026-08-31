# Referência — Login Analytics QuartaVia

## Variáveis de ambiente

### Auth (login — browser + validação API)

```env
AUTH_SUPABASE_URL=https://<auth-project>.supabase.co
AUTH_SUPABASE_ANON_KEY=eyJ...   # anon/public — NUNCA service_role
```

Opcional server-side (não expor ao client):
```env
AUTH_SUPABASE_SERVICE_ROLE_KEY=...  # não usado pelo fluxo padrão deste app
```

### BASE QV (dados operacionais)

```env
DATA_SUPABASE_URL=https://<base-qv-project>.supabase.co
DATA_SUPABASE_SERVICE_ROLE_KEY=...
```

### App Pharus (read-only analytics)

```env
PHARUS_SUPABASE_URL=https://qvtqufdivpbmubooawdm.supabase.co
PHARUS_SUPABASE_ANON_KEY=...
```

### Business Data / Analytics schema

Mesmo projeto Auth; leitura analytics via **JWT do usuário + anon key**:

```env
BUSINESS_DATA_SUPABASE_URL=   # fallback: AUTH_SUPABASE_URL
# BUSINESS_DATA_SUPABASE_ANON_KEY — NÃO exigido; usa AUTH_SUPABASE_ANON_KEY
```

## Exposição segura ao browser

`GET /api/auth-config` → `lib/env.mjs` `buildAuthConfigResult()`:

- Retorna `authSupabaseUrl`, `authSupabaseAnonKey`, `corporateDomain`
- Rejeita service role na anon key
- Exige HTTPS
- `Cache-Control: no-store`

Cliente Supabase UMD carregado no HTML; `js/auth.mjs` chama `window.supabase.createClient`.

## SessionStorage

| Chave | Conteúdo |
|---|---|
| `qv:authAccess` | Cache UX autorização |
| `qv:intendedHash` | Hash SPA antes do OAuth redirect |

## API — lib/auth.mjs

```javascript
authenticateRequest(request)     // → { user } | { error: Response }
requireCorporateAuth(request)      // → Response | null
requireCorporateAuthUser(request)  // → { user, accessToken } | { error }
getRequestAccessToken(request)     // Bearer token
redactSecrets(string)              // logs seguros
```

Validação: `GET ${AUTH_URL}/auth/v1/user` com `Authorization: Bearer <jwt>` + `apikey: anon`.

Cache server-side de token validado: 30s (`validatedTokens` Map).

## Frontend — exports js/auth.mjs

```javascript
bootAuth({ onAuthenticated, onSignedOut })
signOut()
authenticatedFetch(url, options)
apiFetch(url, options)           // alias
getSession()
getAccessToken()
getUserEmail()
getAuthStatus()                  // loading | unauthenticated | ...
isAuthenticated()
isAuthClientReady()
resolveOAuthRedirectTo(origin)
isAllowedCorporateEmail(email)
```

Global: `window.PortalAuth` (mesmos métodos).

## onAuthStateChange (resumo)

| Evento | Ação |
|---|---|
| `INITIAL_SESSION` | ignorar |
| `SIGNED_OUT` | login (exceto se unauthorizedDomain) |
| `TOKEN_REFRESHED` + já authenticated | atualizar sessão silencioso |
| `SIGNED_IN` / `USER_UPDATED` | `applySession` |

## applySession

1. Sem email → login
2. `!isAllowedCorporateEmail(email)` → `signOut` + `unauthorizedDomain`
3. OK → `renderPortal()` + cache

## authenticatedFetch

1. `getSession()` — exige token + domínio válido
2. Request com `Authorization: Bearer`
3. 401 → `refreshSession` → retry
4. 401 persistente → `expireSession`
5. 403 → `rejectInvalidDomainSession`

## HTML (index.html)

```html
<body data-auth="loading">
  <div id="auth-root">...</div>
  <div id="portal-root" hidden>...</div>
</body>
```

Login copy: "Use sua conta @quartavia.com.br"

## Handlers que exigem auth (amostra)

Todos seguem o padrão `requireCorporateAuth`:

- `lib/analytics/*-handler.mjs` (dashboard, statistical-crosses, mechanisms, etc.)
- `lib/analytics/reports-handler.mjs` → `requireCorporateAuthUser` (upload/metadata)
- `lib/assistant/assistant-handler.mjs`

Injetável em testes: `deps.requireCorporateAuth = async () => null`.

## Analytics JWT (Business Data)

`lib/data/analytics-rest.mjs` — headers:

```
apikey: AUTH_SUPABASE_ANON_KEY
Authorization: Bearer <user-jwt>
Accept-Profile: analytics
```

Recusa usar URL da BASE QV (`base_qv_refused`).

SQL RLS: `sql/analytics/004_authenticated_access.sql` — policies `authenticated`.

## Troubleshooting OAuth

1. Confirmar origin exato no browser (localhost porta, preview Vercel)
2. Supabase Dashboard → Authentication → URL Configuration → Redirect URLs
3. Verificar `redirectTo` no log dev (`?authdebug=1` ou localhost)
4. Google Cloud OAuth client aponta para callback Supabase Auth
5. Limpar `#access_token` residual — `cleanAuthParamsFromUrl()` já faz isso

## Mensagens padrão

| Constante | Texto |
|---|---|
| `INVALID_DOMAIN_MESSAGE` | O acesso é permitido somente para contas @quartavia.com.br. |
| `SESSION_EXPIRED_MESSAGE` | Sua sessão expirou. Entre novamente. |

Páginas individuais também usam: "O portal é restrito a contas @quartavia.com.br."

## Diferença: gate de login vs filtro analítico

- **Gate de acesso** (`corporateEmail.mjs`, `lib/auth.mjs`): split `@` + igualdade exata
- **Filtro de dados** (ex.: excluir `@quartavia.com.br` de métricas Pharus): pode usar `endsWith` — **não** reutilizar como auth

## Diagrama projetos

```
Browser
  │ OAuth + JWT
  ▼
Auth Supabase (rckpuebaiswrxzmywllv)
  │
  ├─► /auth/v1/user (validação API)
  └─► analytics.* RLS (JWT + anon)

Server handlers
  │
  ├─► BASE QV (DATA_* service role) — clients, meetings, …
  └─► Pharus (PHARUS_* anon) — metrics, platform_login_events
```
