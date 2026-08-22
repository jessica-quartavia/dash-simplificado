/**
 * Auth Guard — Google OAuth via Supabase Auth (projeto separado da BASE QV).
 * Depende de window.supabase (UMD CDN).
 */
import {
  ALLOWED_GOOGLE_DOMAIN,
  INVALID_DOMAIN_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  isAllowedCorporateEmail,
  isCorporateEmail,
  isQuartaviaEmail,
} from "./corporateEmail.mjs";

export {
  ALLOWED_GOOGLE_DOMAIN,
  isAllowedCorporateEmail,
  isCorporateEmail,
  isQuartaviaEmail,
  INVALID_DOMAIN_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
};

/**
 * @typedef {'initializing' | 'unauthenticated' | 'authenticating' | 'authenticated' | 'unauthorizedDomain' | 'error'} AuthState
 */

/** @type {AuthState} */
let authState = "initializing";
let authSupabase = null;
let session = null;
let authListenerBound = false;
let uiBound = false;
let bootOptions = {};
let sessionExpiryHandled = false;
let sessionExpiryPromise = null;
let lastNotifiedAccessToken = null;
let refreshSessionPromise = null;
let bootReady = false;
let lastBootError = null;

const els = {};
const AUTH_CACHE_KEY = "qv:authAccess";
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;
const INTENDED_HASH_KEY = "qv:intendedHash";
const GET_SESSION_TIMEOUT_MS = 15000;
const BOOT_AUTH_TIMEOUT_MS = 15000;

const isDev =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.search.includes("authdebug=1");

function $(id) {
  return document.getElementById(id);
}

function logAuthDiag(label, extra = {}) {
  if (!isDev) return;
  console.info(`[Boot] ${label}`, extra);
}

function setAuthState(next) {
  authState = next;
  document.body.dataset.auth = next === "initializing" ? "loading" : next;
}

export function getAuthStatus() {
  return authState === "initializing" ? "loading" : authState;
}

export function getSession() {
  return session;
}

export function getAccessToken() {
  return session?.access_token ?? null;
}

export function getUserEmail() {
  return session?.user?.email ?? null;
}

export function getSupabase() {
  return authSupabase;
}

export function isAuthenticated() {
  return authState === "authenticated" && Boolean(session?.access_token);
}

export function isAuthClientReady() {
  return Boolean(authSupabase?.auth) && bootReady;
}

export function resolveOAuthRedirectTo(origin = window.location.origin) {
  const base = String(origin || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Não foi possível determinar o origin para redirect OAuth.");
  return `${base}/`;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} excedeu ${ms}ms`);
      err.code = "AUTH_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readAuthCache() {
  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.userId || !parsed?.email || parsed.authorized !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthCache(user) {
  if (!user?.id || !user?.email) return;
  try {
    sessionStorage.setItem(
      AUTH_CACHE_KEY,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        authorized: true,
        checkedAt: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function clearAuthCache() {
  try {
    sessionStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function cacheCompatible(cache, nextSession) {
  if (!cache || !nextSession?.user) return false;
  return cache.userId === nextSession.user.id && cache.email === nextSession.user.email;
}

async function loadPublicConfig() {
  const response = await withTimeout(
    fetch(`/api/auth-config?t=${Date.now()}`, { cache: "no-store" }),
    GET_SESSION_TIMEOUT_MS,
    "auth-config",
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const missing =
      response.status === 503 ||
      /AUTH_SUPABASE|configure|ausente|missing/i.test(String(payload.error || ""));
    const err = new Error(
      payload.error || "Não foi possível carregar a configuração de autenticação.",
    );
    err.code = missing ? "AUTH_CONFIG_MISSING" : "AUTH_CONFIG_ERROR";
    err.status = response.status;
    throw err;
  }
  const url = String(payload.authSupabaseUrl || "").trim().replace(/\/$/, "");
  const anonKey = String(payload.authSupabaseAnonKey || "").trim();
  if (!url || !anonKey) {
    const err = new Error("Configuração de autenticação ausente.");
    err.code = "AUTH_CONFIG_MISSING";
    throw err;
  }
  if (!/^https:\/\//i.test(url)) {
    const err = new Error("AUTH_SUPABASE_URL deve usar HTTPS.");
    err.code = "AUTH_CONFIG_INVALID";
    throw err;
  }
  if (/service_role/i.test(anonKey)) {
    const err = new Error("Chave de serviço detectada no navegador. Use a anon key.");
    err.code = "AUTH_CONFIG_INVALID";
    throw err;
  }
  return { authSupabaseUrl: url, authSupabaseAnonKey: anonKey };
}

function resolveCreateClient() {
  const createClient = window.supabase?.createClient;
  if (typeof createClient !== "function") {
    const err = new Error("Biblioteca Supabase JS não carregou. Verifique a conexão com a CDN.");
    err.code = "SUPABASE_CDN_MISSING";
    throw err;
  }
  return createClient;
}

function cacheElements() {
  els.gate = $("auth-root");
  els.app = $("portal-root");
  els.loading = $("auth-loading");
  els.login = $("auth-login");
  els.googleBtn = $("auth-google");
  els.message = $("auth-message");
  els.userEmail = $("auth-user-email");
  els.userName = $("auth-user-name");
  els.userAvatar = $("auth-user-avatar");
  els.signOut = $("auth-sign-out");
}

function showPanel(name) {
  if (els.loading) els.loading.hidden = name !== "loading";
  if (els.login) els.login.hidden = name !== "login";
}

function setGoogleButtonEnabled(enabled, label) {
  if (!els.googleBtn) return;
  const ready = Boolean(enabled && authSupabase?.auth && bootReady);
  els.googleBtn.disabled = !ready;
  els.googleBtn.setAttribute("aria-disabled", ready ? "false" : "true");
  if (label) {
    els.googleBtn.textContent = label;
  } else {
    els.googleBtn.innerHTML =
      '<span class="auth-google-icon" aria-hidden="true"></span> Continuar com Google';
  }
}

function resetGoogleButton() {
  setGoogleButtonEnabled(Boolean(authSupabase?.auth && bootReady));
}

function renderAuthLoading() {
  if (authState === "authenticated") return;
  setAuthState("initializing");
  bootReady = false;
  if (els.gate) els.gate.hidden = false;
  if (els.app) els.app.hidden = true;
  showPanel("loading");
  setGoogleButtonEnabled(false, "Preparando autenticação…");
}

function renderLoginPage(message = "") {
  clearAuthCache();
  setAuthState("unauthenticated");
  clearHeaderUser();
  if (els.gate) els.gate.hidden = false;
  if (els.app) els.app.hidden = true;
  showPanel("login");
  setLoginMessage(message);
  hideAuthErrorActions();
  resetGoogleButton();
}

function renderUnauthorizedDomain() {
  clearAuthCache();
  setAuthState("unauthorizedDomain");
  clearHeaderUser();
  if (els.gate) els.gate.hidden = false;
  if (els.app) els.app.hidden = true;
  showPanel("login");
  setLoginMessage(INVALID_DOMAIN_MESSAGE);
  resetGoogleButton();
}

function renderAuthError(message, { allowRetry = true } = {}) {
  setAuthState("error");
  if (els.gate) els.gate.hidden = false;
  if (els.app) els.app.hidden = true;
  showPanel("login");
  setLoginMessage(message || "Não foi possível verificar o acesso.");
  if (allowRetry) {
    showAuthErrorActions();
    bootReady = Boolean(authSupabase?.auth);
    resetGoogleButton();
  } else {
    hideAuthErrorActions();
    bootReady = false;
    setGoogleButtonEnabled(false);
  }
}

function userDisplayName(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || meta.user_name || "";
}

function userAvatarUrl(user) {
  const meta = user?.user_metadata || {};
  return meta.avatar_url || meta.picture || "";
}

function updateHeaderUser(user) {
  const email = user?.email || "";
  const name = userDisplayName(user);
  const avatar = userAvatarUrl(user);

  if (els.userEmail) {
    els.userEmail.textContent = email;
    els.userEmail.title = email;
  }
  if (els.userName) {
    els.userName.textContent = name || email.split("@")[0] || "";
    els.userName.hidden = !(name || email);
  }
  if (els.userAvatar) {
    if (avatar) {
      els.userAvatar.src = avatar;
      els.userAvatar.alt = name || email || "Avatar";
      els.userAvatar.hidden = false;
    } else {
      els.userAvatar.removeAttribute("src");
      els.userAvatar.hidden = true;
    }
  }
}

function clearHeaderUser() {
  if (els.userEmail) {
    els.userEmail.textContent = "";
    els.userEmail.title = "";
  }
  if (els.userName) {
    els.userName.textContent = "";
    els.userName.hidden = true;
  }
  if (els.userAvatar) {
    els.userAvatar.removeAttribute("src");
    els.userAvatar.hidden = true;
  }
}

function renderPortal() {
  setAuthState("authenticated");
  bootReady = true;
  if (session?.user) writeAuthCache(session.user);
  if (els.gate) els.gate.hidden = true;
  if (els.app) els.app.hidden = false;
  updateHeaderUser(session?.user);
}

function setLoginMessage(text) {
  if (!els.message) return;
  if (!text) {
    els.message.hidden = true;
    els.message.textContent = "";
    hideAuthErrorActions();
    return;
  }
  els.message.hidden = false;
  els.message.textContent = text;
}

function ensureAuthErrorActions() {
  if (els.errorActions) return;
  const wrap = document.createElement("div");
  wrap.id = "auth-error-actions";
  wrap.className = "auth-error-actions";
  wrap.hidden = true;
  wrap.innerHTML = `
    <button type="button" class="btn btn-secondary" id="auth-retry">Tentar novamente</button>
    <button type="button" class="btn btn-ghost" id="auth-gate-sign-out">Sair</button>
  `;
  els.login?.appendChild(wrap);
  els.errorActions = wrap;
  $("auth-retry")?.addEventListener("click", () => {
    hideAuthErrorActions();
    void bootAuth(bootOptions);
  });
  $("auth-gate-sign-out")?.addEventListener("click", () => {
    void signOut().finally(() => {
      window.location.assign(`${window.location.pathname}${window.location.search}`);
    });
  });
}

function showAuthErrorActions() {
  ensureAuthErrorActions();
  if (els.errorActions) els.errorActions.hidden = false;
}

function hideAuthErrorActions() {
  if (els.errorActions) els.errorActions.hidden = true;
}

function friendlyAuthError(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  const code = err?.code || "";
  const lower = raw.toLowerCase();
  console.error("[auth]", err);

  if (code === "AUTH_CONFIG_MISSING" || lower.includes("ausente") || lower.includes("configure auth_supabase")) {
    return "Configuração de autenticação ausente. Defina AUTH_SUPABASE_URL e AUTH_SUPABASE_ANON_KEY.";
  }
  if (code === "AUTH_CONFIG_INVALID" || lower.includes("https") || lower.includes("service")) {
    return "Configuração de autenticação inválida.";
  }
  if (code === "AUTH_TIMEOUT" || lower.includes("excedeu")) {
    return "Não foi possível verificar seu acesso. Tente novamente.";
  }
  if (lower.includes("popup") && (lower.includes("closed") || lower.includes("cancel"))) {
    return "Login cancelado. Tente novamente.";
  }
  if (lower.includes("access_denied") || lower.includes("cancelled") || lower.includes("canceled")) {
    return "Login cancelado. Tente novamente.";
  }
  if (lower.includes("provider") || (lower.includes("google") && lower.includes("not enabled"))) {
    return "O login com Google ainda não está configurado. Contate o administrador.";
  }
  if (code === "SUPABASE_CDN_MISSING" || lower.includes("cdn") || lower.includes("biblioteca supabase")) {
    return "Não foi possível carregar o cliente de autenticação. Verifique a rede e tente novamente.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "Erro de rede. Verifique sua conexão e tente novamente.";
  }
  if (lower.includes("redirect") || lower.includes("redirect_uri")) {
    return "URL de redirecionamento não autorizada. Inclua este origin na allowlist do Supabase Auth.";
  }
  return "Não foi possível entrar com o Google. Tente novamente.";
}

function isTransientAuthError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();
  return (
    err?.code === "AUTH_TIMEOUT" ||
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("excedeu")
  );
}

function detectAuthCallbackError() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const error = hash.get("error") || query.get("error");
  const description =
    hash.get("error_description") ||
    query.get("error_description") ||
    hash.get("error_code") ||
    "";
  if (!error) return null;
  const lower = `${error} ${description}`.toLowerCase();
  if (lower.includes("access_denied")) {
    return "Login cancelado. Tente novamente.";
  }
  return "Não foi possível concluir o acesso com o Google. Tente novamente.";
}

function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  let dirty = false;
  ["error", "error_description", "error_code", "code", "state", "type"].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      dirty = true;
    }
  });
  if (url.hash && /access_token|refresh_token|error=|type=|provider_token/.test(url.hash)) {
    url.hash = "";
    dirty = true;
  }
  if (dirty) {
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
}

async function rejectInvalidDomainSession() {
  session = null;
  clearAuthCache();
  try {
    await authSupabase?.auth.signOut();
  } catch {
    /* ignore */
  }
  renderUnauthorizedDomain();
  bootOptions.onSignedOut?.();
}

async function applySession(nextSession) {
  session = nextSession || null;
  const email = nextSession?.user?.email;

  if (!nextSession || !email) {
    renderLoginPage("");
    return { ok: false };
  }
  if (!isAllowedCorporateEmail(email)) {
    await rejectInvalidDomainSession();
    return { ok: false, reason: "unauthorizedDomain" };
  }
  sessionExpiryHandled = false;
  renderPortal();
  return { ok: true };
}

function notifyAuthenticated() {
  if (!isAuthenticated()) return;
  if (lastNotifiedAccessToken === session.access_token) return;
  lastNotifiedAccessToken = session.access_token;
  bootOptions.onAuthenticated?.();
}

async function expireSession(message = SESSION_EXPIRED_MESSAGE) {
  if (sessionExpiryPromise) return sessionExpiryPromise;
  if (sessionExpiryHandled) return;

  sessionExpiryHandled = true;
  lastNotifiedAccessToken = null;
  session = null;
  clearAuthCache();
  sessionExpiryPromise = (async () => {
    try {
      await authSupabase?.auth.signOut({ scope: "local" });
    } catch {
      /* ignore */
    }
    renderLoginPage(message);
    bootOptions.onSignedOut?.();
  })();

  try {
    await sessionExpiryPromise;
  } finally {
    sessionExpiryPromise = null;
  }
}

async function verifyStoredSession(candidate) {
  if (!candidate?.access_token) return null;

  const verify = await withTimeout(
    authSupabase.auth.getUser(candidate.access_token),
    GET_SESSION_TIMEOUT_MS,
    "getUser",
  );
  if (!verify.error && verify.data?.user) {
    return { ...candidate, user: verify.data.user };
  }

  const refreshed = await withTimeout(
    authSupabase.auth.refreshSession(),
    GET_SESSION_TIMEOUT_MS,
    "refreshSession",
  );
  if (!refreshed.error && refreshed.data?.session?.access_token) {
    const refreshedSession = refreshed.data.session;
    const refreshedUser = await withTimeout(
      authSupabase.auth.getUser(refreshedSession.access_token),
      GET_SESSION_TIMEOUT_MS,
      "getUser(refreshed)",
    );
    if (!refreshedUser.error && refreshedUser.data?.user) {
      return { ...refreshedSession, user: refreshedUser.data.user };
    }
  }

  if (isTransientAuthError(verify.error) || isTransientAuthError(refreshed.error)) {
    session = candidate;
    renderAuthError("Não foi possível validar sua sessão agora. Verifique a conexão e tente novamente.");
    return null;
  }
  await expireSession();
  return null;
}

async function refreshSessionOnce() {
  if (!refreshSessionPromise) {
    refreshSessionPromise = authSupabase.auth.refreshSession().finally(() => {
      refreshSessionPromise = null;
    });
  }
  return refreshSessionPromise;
}

export async function authenticatedFetch(url, options = {}) {
  if (!authSupabase) {
    const err = new Error("AUTH_REQUIRED");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  const doFetch = async (token) => {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  };

  const { data: fresh, error: sessionError } = await authSupabase.auth.getSession();
  if (sessionError) {
    console.error("[auth] getSession", sessionError);
  }
  session = fresh?.session ?? session ?? null;

  if (!session?.access_token || !isAllowedCorporateEmail(session.user?.email)) {
    if (session && !isAllowedCorporateEmail(session.user?.email)) {
      await rejectInvalidDomainSession();
    } else {
      await expireSession();
    }
    const err = new Error("AUTH_REQUIRED");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (authState !== "authenticated") {
    renderPortal();
  }

  let response = await doFetch(session.access_token);

  if (response.status === 401) {
    const { data, error } = await refreshSessionOnce();
    if (!error && data?.session?.access_token) {
      session = data.session;
      response = await doFetch(data.session.access_token);
    }
  }

  if (response.status === 401) {
    await expireSession();
    const err = new Error("AUTH_REQUIRED");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  if (response.status === 403) {
    await rejectInvalidDomainSession();
    const err = new Error("AUTH_FORBIDDEN");
    err.code = "AUTH_FORBIDDEN";
    throw err;
  }

  return response;
}

export async function apiFetch(url, options = {}) {
  return authenticatedFetch(url, options);
}

async function handleGoogleSignIn() {
  setLoginMessage("");
  if (!authSupabase?.auth || !bootReady) {
    const msg = lastBootError
      ? friendlyAuthError(lastBootError)
      : "Autenticação ainda não inicializada. Aguarde ou recarregue a página.";
    setLoginMessage(msg);
    setGoogleButtonEnabled(false);
    return;
  }

  setAuthState("authenticating");
  setGoogleButtonEnabled(false, "Redirecionando…");

  try {
    sessionStorage.setItem(INTENDED_HASH_KEY, window.location.hash || "");
  } catch {
    /* ignore */
  }

  const redirectTo = resolveOAuthRedirectTo(window.location.origin);
  logAuthDiag("oauth-start", { redirectTo });

  try {
    const { data, error } = await authSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          hd: ALLOWED_GOOGLE_DOMAIN,
          prompt: "select_account",
        },
      },
    });
    if (error) {
      console.error("[OAuth error]", error);
      setLoginMessage(friendlyAuthError(error));
      setAuthState("error");
      showPanel("login");
      bootReady = true;
      resetGoogleButton();
      return;
    }
    if (data?.url) {
      window.location.assign(data.url);
    }
  } catch (err) {
    console.error("[OAuth error]", err);
    setLoginMessage(friendlyAuthError(err));
    setAuthState("error");
    showPanel("login");
    bootReady = true;
    resetGoogleButton();
  }
}

export async function signOut() {
  clearAuthCache();
  try {
    await authSupabase?.auth.signOut();
  } catch {
    /* ignore */
  }
  session = null;
  sessionExpiryHandled = false;
  lastNotifiedAccessToken = null;
  renderLoginPage("");
  bootOptions.onSignedOut?.();
}

function bindUi() {
  if (uiBound) return;
  uiBound = true;

  els.googleBtn?.addEventListener("click", () => {
    void handleGoogleSignIn();
  });
  els.signOut?.addEventListener("click", () => {
    void signOut();
  });
}

function bindAuthListener() {
  if (authListenerBound || !authSupabase) return;
  authListenerBound = true;

  authSupabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (event === "INITIAL_SESSION") return;

    if (event === "SIGNED_OUT") {
      session = null;
      lastNotifiedAccessToken = null;
      clearAuthCache();
      if (sessionExpiryHandled) return;
      if (authState !== "unauthorizedDomain") {
        renderLoginPage("");
      }
      bootOptions.onSignedOut?.();
      return;
    }

    if (event === "TOKEN_REFRESHED" && authState === "authenticated" && nextSession) {
      session = nextSession;
      if (nextSession.user) writeAuthCache(nextSession.user);
      notifyAuthenticated();
      return;
    }

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      if (!nextSession) return;
      sessionExpiryHandled = false;
      const applied = await applySession(nextSession);
      if (applied.ok) notifyAuthenticated();
    }
  });
}

/**
 * @param {{ onAuthenticated?: () => void, onSignedOut?: () => void }} options
 */
export async function bootAuth(options = {}) {
  bootOptions = options;
  lastBootError = null;
  bootReady = false;
  cacheElements();
  bindUi();
  renderAuthLoading();
  logAuthDiag("start");

  try {
    await withTimeout(bootAuthInner(), BOOT_AUTH_TIMEOUT_MS, "bootAuth");
  } catch (err) {
    lastBootError = err;
    bootReady = Boolean(authSupabase?.auth);
    console.error("[auth] boot failed:", err);
    renderAuthError(friendlyAuthError(err), { allowRetry: true });
  }
}

async function bootAuthInner() {
  const callbackError = detectAuthCallbackError();

  try {
    logAuthDiag("auth config start");
    const config = await loadPublicConfig();
    const createClient = resolveCreateClient();
    authSupabase = createClient(config.authSupabaseUrl, config.authSupabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    logAuthDiag("auth client ready");

    bindAuthListener();

    logAuthDiag("getSession start");
    const sessionResult = await withTimeout(
      authSupabase.auth.getSession(),
      GET_SESSION_TIMEOUT_MS,
      "getSession",
    );
    logAuthDiag("getSession done", { hasSession: Boolean(sessionResult?.data?.session) });

    const { data, error } = sessionResult;
    if (error) throw error;

    cleanAuthParamsFromUrl();
    bootReady = true;

    if (callbackError && !data.session) {
      renderLoginPage(callbackError);
      return;
    }

    if (!data.session) {
      logAuthDiag("no session — login");
      renderLoginPage("");
      return;
    }

    logAuthDiag("corporate check");
    const cache = readAuthCache();
    const cacheFresh =
      cache &&
      (!cache.checkedAt || Date.now() - cache.checkedAt < AUTH_CACHE_TTL_MS * 24);
    if (data.session && cacheCompatible(cache, data.session) && cacheFresh) {
      session = data.session;
      if (isAllowedCorporateEmail(data.session.user?.email)) {
        renderPortal();
        notifyAuthenticated();
        void verifyStoredSession(data.session).then((verified) => {
          if (verified) void applySession(verified);
        });
        return;
      }
    }

    const verifiedSession = await verifyStoredSession(data.session);
    if (!verifiedSession) {
      if (authState === "error" || authState === "unauthorizedDomain") return;
      if (!data.session && !callbackError) renderLoginPage("");
      return;
    }

    const applied = await applySession(verifiedSession);
    if (applied.ok) {
      logAuthDiag("mount shell pending");
      notifyAuthenticated();
    }
  } catch (err) {
    lastBootError = err;
    bootReady = Boolean(authSupabase?.auth);
    throw err;
  }
}

window.PortalAuth = {
  bootAuth,
  apiFetch,
  authenticatedFetch,
  signOut,
  getSession,
  getAccessToken,
  getUserEmail,
  getAuthStatus,
  getSupabase,
  isAuthenticated,
  isAuthClientReady,
  isAllowedCorporateEmail,
  isCorporateEmail,
  isQuartaviaEmail,
  resolveOAuthRedirectTo,
};
