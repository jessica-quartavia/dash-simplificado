import { handleMechanismsRequest } from "../lib/analytics/mechanisms-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[mechanisms] incoming ${req.method || "GET"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handleMechanismsRequest(request);
  await sendWebResponse(res, response, { logPrefix: "mechanisms" });
}
