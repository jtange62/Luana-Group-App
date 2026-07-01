import { json, verifyToken, bearer, clean } from "./_helpers.js";

// List curriculum weeks. Optionally scoped to one theme via ?lesson=<id>;
// the Curriculum tool just loads them all and groups client-side.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const lessonId = clean(url.searchParams.get("lesson"), 60);

  const stmt = lessonId
    ? env.DB.prepare("SELECT * FROM curriculum_weeks WHERE lesson_id = ? ORDER BY week_no ASC").bind(lessonId)
    : env.DB.prepare("SELECT * FROM curriculum_weeks ORDER BY lesson_id, week_no ASC");

  const res = await stmt.all();
  return json({ weeks: res.results || [] });
}
