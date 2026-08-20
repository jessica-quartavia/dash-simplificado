/** Cliente HTTP do Assistente V2. */

export function mapAssistantError(error, response, { debug = false } = {}) {
  const code = error?.code || response?.status;
  if (code === "AUTH_REQUIRED" || response?.status === 401) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (response?.status === 403) {
    return "O acesso é permitido somente para contas @quartavia.com.br.";
  }
  if (code === "invalid_json" || code === "message_required") {
    return "Não foi possível enviar sua pergunta. Verifique a mensagem e tente novamente.";
  }
  if (code === "config" || code === "catalog_unavailable") {
    return "O catálogo analítico está indisponível no momento. Tente novamente em instantes.";
  }
  if (error?.code === "compute_timeout" || error?.reason === "compute_timeout") {
    return "Não consegui consultar o valor agora, mas posso explicar como esse indicador é calculado.";
  }
  if (error?.code === "gemini_failed" || error?.code === "gemini_unavailable") {
    return "Não consegui elaborar a resposta agora. Tente novamente.";
  }
  if (response?.status >= 500 || code === "assistant_unavailable") {
    return "Não foi possível processar sua pergunta agora. Tente novamente em instantes.";
  }
  if (debug && error?.errorCategory) {
    const suffix = error.requestId ? ` (${error.errorCategory}, ${error.requestId})` : ` (${error.errorCategory})`;
    return `Não foi possível enviar sua pergunta. Tente novamente.${suffix}`;
  }
  return "Não foi possível enviar sua pergunta. Tente novamente.";
}

export async function postAssistantMessage({ message, history, fetchImpl }) {
  const fetchFn = fetchImpl;
  if (typeof fetchFn !== "function") {
    const err = new Error("AUTH_REQUIRED");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  const started = Date.now();
  const response = await fetchFn("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  const requestMs = Date.now() - started;
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    const err = new Error(body?.error || "assistant_failed");
    err.code = body?.code || (response.status === 401 ? "AUTH_REQUIRED" : "assistant_failed");
    err.errorCategory = body?.error_category || null;
    err.requestId = body?.request_id || null;
    err.response = response;
    err.requestMs = requestMs;
    throw err;
  }

  return {
    ...body,
    meta: {
      ...(body.meta || {}),
      request_ms: requestMs,
      total_ms: body.meta?.timings_ms?.totalMs ?? requestMs,
    },
  };
}
