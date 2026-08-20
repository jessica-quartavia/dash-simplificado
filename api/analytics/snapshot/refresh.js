import { handleMetricSnapshotRefreshRequest } from "../../../lib/analytics/snapshot-refresh-handler.mjs";
import { nodeToWebRequest, sendWebResponse } from "../../../lib/http/node-fetch-bridge.mjs";

export default async function handler(req, res) {
  const request = await nodeToWebRequest(req);
  const hasAuth = Boolean(request.headers.get("authorization"));
  console.info(`[snapshot-refresh] incoming ${req.method || "POST"} authorization=${hasAuth ? "sim" : "não"}`);
  const response = await handleMetricSnapshotRefreshRequest(request);
  await sendWebResponse(res, response, { logPrefix: "snapshot-refresh" });
}
