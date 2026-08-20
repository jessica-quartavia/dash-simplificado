import { handleDashboardApi } from "../lib/api/dashboard-router.mjs";

export default async function handler(req, res) {
  await handleDashboardApi(req, res);
}
