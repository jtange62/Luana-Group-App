import { json, verifyToken, bearer, clean } from "./_helpers.js";

function cleanDate(raw) {
  const v = clean(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Set (or update) a week's daily sub-theme for a date — e.g. Summer School's
// day themes with target vocab. One row per week+date: upsert.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const weekId = clean(body.week_id, 60);
  if (!weekId) return json({ error: "missing week_id" }, 400);
  const date = cleanDate(body.date);
  if (!date) return json({ error: "valid date required" }, 400);
  const subtheme = clean(body.subtheme, 500) || null;
  const vocab = clean(body.vocab, 2000) || null;
  const activities = clean(body.activities, 4000) || null;
  if (!subtheme && !vocab && !activities) return json({ error: "empty" }, 400);

  const week = await env.DB.prepare("SELECT id FROM curriculum_weeks WHERE id = ?").bind(weekId).first();
  if (!week) return json({ error: "week not found" }, 404);

  await env.DB.prepare(
    "INSERT INTO week_days (id, week_id, date, subtheme, vocab, activities, author, created_at) VALUES (?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(week_id, date) DO UPDATE SET subtheme = excluded.subtheme, vocab = excluded.vocab, activities = excluded.activities, author = excluded.author"
  ).bind(
    crypto.randomUUID(), weekId, date, subtheme, vocab, activities,
    clean(body.author, 60) || "anonymous",
    Date.now()
  ).run();

  return json({ ok: true });
}

// Remove a day's sub-theme.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const weekId = clean(body.week_id, 60);
  const date = cleanDate(body.date);
  if (!weekId || !date) return json({ error: "missing week_id or date" }, 400);

  await env.DB.prepare("DELETE FROM week_days WHERE week_id = ? AND date = ?").bind(weekId, date).run();
  return json({ ok: true });
}
