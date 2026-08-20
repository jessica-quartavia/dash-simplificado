import { handlePatrimonialPlanRequest } from "../lib/analytics/patrimonial-plan-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[patrimonial-plan] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handlePatrimonialPlanRequest(request);
  await sendWebResponse(res, response, { logPrefix: "patrimonial-plan" });
}
