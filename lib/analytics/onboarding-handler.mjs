/**
 * Handler HTTP de Jornada e Onboarding (Fetch Request → Response).
 * Autenticação corporativa obrigatória. Service role permanece no servidor.
 */
import { requireCorporateAuth } from "../auth.mjs";
import { dataConfigurationError } from "../env.mjs";
import { computeOnboardingPayload, toPublicOnboardingPayload } from "./onboarding.mjs";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleOnboardingRequest(request, deps = {}) {
  const startedAt = Date.now();
  const method = request?.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Método não permitido.", code: "METHOD_NOT_ALLOWED" });
  }

  const requireAuth = deps.requireCorporateAuth || requireCorporateAuth;
  const denied = await requireAuth(request);
  const authMs = Date.now() - startedAt;
  if (denied) {
    console.info(`[onboarding] status=${denied.status} auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return denied;
  }

  const configError = (deps.dataConfigurationError || dataConfigurationError)();
  if (configError) {
    console.info(`[onboarding] status=503 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(503, { error: configError, code: "config" });
  }

  try {
    const compute = deps.computeOnboardingPayload || computeOnboardingPayload;
    const payload = await compute();
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const publicPayload = toPublicOnboardingPayload(payload);
    const timing = payload?.timing || {};
    console.info(
      `[onboarding] status=200 auth=${authMs}ms compute=${timing.totalMs ?? "—"}ms transform=${timing.transformMs ?? "—"}ms total=${Date.now() - startedAt}ms`,
    );
    return json(200, publicPayload);
  } catch (error) {
    if (error?.code === "config") {
      return json(503, { error: error.message, code: "config" });
    }
    console.error("[Data] onboarding failed:", error instanceof Error ? error.message : error);
    console.info(`[onboarding] status=500 auth=${authMs}ms total=${Date.now() - startedAt}ms`);
    return json(500, {
      error: "Não foi possível consultar a jornada e o onboarding.",
      code: "data_query_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
