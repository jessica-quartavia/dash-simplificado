/**
 * Classificação de erros PostgREST do controle de acesso.
 * Não logar JWT, anon key ou Authorization.
 */
export function parseAccessPostgrestBody(textOrObject) {
  if (textOrObject && typeof textOrObject === "object") {
    return {
      code: textOrObject.code ?? null,
      message: textOrObject.message || textOrObject.error || null,
      details: textOrObject.details ?? null,
      hint: textOrObject.hint ?? null,
    };
  }
  const raw = String(textOrObject || "").trim();
  if (!raw) return { code: null, message: null, details: null, hint: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      code: parsed?.code ?? null,
      message: parsed?.message || parsed?.error || null,
      details: parsed?.details ?? null,
      hint: parsed?.hint ?? null,
    };
  } catch {
    return { code: null, message: raw.slice(0, 240), details: null, hint: null };
  }
}

export function classifyAccessPostgrestError(status, body) {
  const pg = parseAccessPostgrestBody(body);
  const haystack = [pg.code, pg.message, pg.details, pg.hint].filter(Boolean).join(" ");

  if (
    pg.code === "PGRST106"
    || /invalid schema:\s*analytics|schema must be one of|not exposed/i.test(haystack)
  ) {
    return {
      code: "access_schema_not_exposed",
      error: "Não foi possível verificar o acesso agora.",
      postgrestCode: pg.code || "PGRST106",
      postgrestMessage: pg.message,
    };
  }

  if (
    Number(status) === 404
    || pg.code === "PGRST205"
    || pg.code === "42P01"
    || /could not find the table|relation .* does not exist|does not exist/i.test(haystack)
  ) {
    return {
      code: "access_schema_missing",
      error: "Tabelas de acesso ainda não foram aplicadas no Business Data.",
      postgrestCode: pg.code,
      postgrestMessage: pg.message,
    };
  }

  if (/infinite recursion|42P17/i.test(haystack)) {
    return {
      code: "access_rls_recursion",
      error: "Não foi possível verificar o acesso agora.",
      postgrestCode: pg.code || "42P17",
      postgrestMessage: pg.message,
    };
  }

  return {
    code: "access_unavailable",
    error: "Não foi possível verificar o acesso agora.",
    postgrestCode: pg.code,
    postgrestMessage: pg.message,
    status: Number(status) || 503,
  };
}

export function logAccessLookup(label, extra = {}) {
  const safe = { ...extra };
  delete safe.token;
  delete safe.accessToken;
  delete safe.authorization;
  delete safe.anonKey;
  console.info(`[access] ${label}`, safe);
}
