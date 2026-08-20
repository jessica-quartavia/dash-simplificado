/**
 * Classificação segura de erros PostgREST para analytics.reports.
 * Não logar JWT, anon key ou cookies.
 */

export function parsePostgrestErrorBody(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { code: null, message: null, details: null, hint: null };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      code: parsed?.code ?? null,
      message: parsed?.message ?? null,
      details: parsed?.details ?? null,
      hint: parsed?.hint ?? null,
    };
  } catch {
    return { code: null, message: raw.slice(0, 240), details: null, hint: null };
  }
}

export function classifyReportsPostgrestError(status, bodyText) {
  const pg = parsePostgrestErrorBody(bodyText);
  const haystack = [pg.code, pg.message, pg.details, pg.hint].filter(Boolean).join(" ").toLowerCase();

  if (Number(status) === 401) {
    return { code: "unauthorized", category: "unauthorized", postgrestCode: pg.code, postgrestMessage: pg.message };
  }

  if (
    pg.code === "PGRST106"
    || /schema must be one of|invalid schema|not exposed/i.test(haystack)
  ) {
    return {
      code: "reports_schema_not_exposed",
      category: "schema_not_exposed",
      postgrestCode: pg.code,
      postgrestMessage: pg.message,
    };
  }

  if (
    pg.code === "42501"
    || pg.code === "PGRST301"
    || /permission denied/i.test(haystack)
  ) {
    return {
      code: "reports_permission_denied",
      category: "permission_denied",
      postgrestCode: pg.code,
      postgrestMessage: pg.message,
    };
  }

  if (
    pg.code === "PGRST205"
    || pg.code === "42P01"
    || /could not find the table|relation .* does not exist|does not exist/i.test(haystack)
  ) {
    return {
      code: "reports_table_missing",
      category: "table_missing",
      postgrestCode: pg.code,
      postgrestMessage: pg.message,
    };
  }

  return {
    code: "reports_query_failed",
    category: "query_failed",
    postgrestCode: pg.code,
    postgrestMessage: pg.message,
  };
}

export function logReportsPostgrest(context, status, bodyText, classification) {
  const pg = parsePostgrestErrorBody(bodyText);
  console.info(
    `[Reports] ${context} postgrest status=${status} code=${pg.code || "n/a"} category=${classification.category}`,
  );
}

export function reportsErrorMessage(code) {
  switch (code) {
    case "reports_schema_not_exposed":
      return "Relatórios ainda não estão disponíveis pela Data API.";
    case "reports_permission_denied":
      return "Seu acesso à área de Relatórios ainda não foi configurado.";
    case "reports_table_missing":
      return "A estrutura de Relatórios ainda não foi criada.";
    case "reports_bucket_missing":
      return "O armazenamento de relatórios ainda não foi configurado.";
    case "unauthorized":
      return "Sessão expirada. Faça login novamente.";
    default:
      return "Não foi possível consultar os relatórios.";
  }
}
