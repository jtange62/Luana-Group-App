import { json, verifyToken, bearer } from "./_helpers.js";

// Return every event. Recurring events are expanded into occurrences on the
// client for whichever month is being viewed, so we just hand over the rules.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const res = await env.DB.prepare(
    "SELECT * FROM events ORDER BY start_date ASC, start_time ASC LIMIT 2000"
  ).all();
  return json({ events: res.results || [] });
}
