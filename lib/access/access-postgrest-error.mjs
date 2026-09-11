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

  if (pg.code === "23505" || /já possui acesso/i.test(haystack)) {
    return {
      code: "duplicate_email",
      error: "Este email já possui acesso.",
      postgrestCode: pg.code || "23505",
      postgrestMessage: pg.message,
      status: 409,
    };
  }

  if (pg.code === "42501" || /somente owners/i.test(haystack)) {
    return {
      code: "forbidden",
      error: "Somente Owners podem gerenciar acessos.",
      postgrestCode: pg.code || "42501",
      postgrestMessage: pg.message,
      status: 403,
    };
  }

  if (pg.code === "P0002" || /usuário não encontrado/i.test(haystack)) {
    return {
      code: "not_found",
      error: "Usuário não encontrado.",
      postgrestCode: pg.code || "P0002",
      postgrestMessage: pg.message,
      status: 404,
    };
  }

  if (pg.code === "22023" || /e-mail @quartavia|grupo inválido/i.test(haystack)) {
    return {
      code: "invalid_request",
      error: pg.message || "Não foi possível salvar o acesso.",
      postgrestCode: pg.code || "22023",
      postgrestMessage: pg.message,
      status: 400,
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
