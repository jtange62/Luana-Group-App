import { json, verifyToken, bearer } from "./_helpers.js";

// Return every event. Recurring events are expanded into occurrences on the
// client for whichever month is being viewed, so we just hand over the rules.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/;
  if ((from || to) && (!validDate.test(from) || !validDate.test(to) || from > to)) {
    return json({ error: "from and to must be a valid date range" }, 400);
  }

  const res = from
    ? await env.DB.prepare(
        `SELECT * FROM events
         WHERE ((recur IS NOT NULL AND recur != 'none')
                AND start_date <= ?
                AND (recur_until IS NULL OR recur_until = '' OR recur_until >= ?))
            OR ((recur IS NULL OR recur = 'none') AND start_date BETWEEN ? AND ?)
         ORDER BY start_date ASC, start_time ASC LIMIT 2000`
      ).bind(to, from, from, to).all()
    : await env.DB.prepare(
        "SELECT * FROM events ORDER BY start_date ASC, start_time ASC LIMIT 2000"
      ).all();
  return json({ events: res.results || [] });
}
