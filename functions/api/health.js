import { json } from "./_helpers.js";

function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  return !!env.HEALTH_CHECK_TOKEN && header === `Bearer ${env.HEALTH_CHECK_TOKEN}`;
}

export async function onRequestGet({ request, env, data }) {
  if (!authorized(request, env)) return json({ error: "not found" }, 404);
  const checks = await Promise.allSettled([
    env.DB.prepare("SELECT 1 AS ok").first(),
    env.FILES.head("__healthcheck__"),
  ]);
  const healthy = checks.every((check) => check.status === "fulfilled");
  if (!healthy) {
    console.error(JSON.stringify({
      level: "error",
      event: "health_check_failed",
      request_id: data.requestId,
      d1: checks[0].status,
      r2: checks[1].status,
    }));
  }
  return json({ status: healthy ? "ok" : "unavailable" }, healthy ? 200 : 503);
}

