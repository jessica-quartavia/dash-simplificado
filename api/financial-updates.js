import { handleFinancialUpdatesRequest } from "../lib/analytics/financial-updates-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const response = await handleFinancialUpdatesRequest(request);
  await sendWebResponse(res, response, { logPrefix: "financial-updates" });
}
