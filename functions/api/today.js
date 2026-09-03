import { json, verifyToken, bearer, clean } from "./_helpers.js";
import { buildToday, DATE_RE } from "./_today.js";

// GET /api/today?date=YYYY-MM-DD
// One payload for the Today page: who is expected, who is marked, allergies in
// the building, what is on, and each class's month theme.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const date = clean(new URL(request.url).searchParams.get("date"), 10);
  if (!DATE_RE.test(date)) return json({ error: "valid date required" }, 400);

  return json(await buildToday(env.DB, date));
}
