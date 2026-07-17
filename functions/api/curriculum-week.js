import { json, verifyToken, bearer, clean } from "./_helpers.js";

function cleanDate(raw) {
  const v = clean(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Create a week within a month theme.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const lessonId = clean(body.lesson_id, 60);
  if (!lessonId) return json({ error: "missing lesson_id" }, 400);

  // The theme must exist — weeks hang off a monthly theme.
  const lesson = await env.DB.prepare("SELECT id FROM lessons WHERE id = ?").bind(lessonId).first();
  if (!lesson) return json({ error: "theme not found" }, 404);

  // Auto-number the new week after the current highest for this theme.
  const maxRow = await env.DB.prepare(
    "SELECT MAX(week_no) AS n FROM curriculum_weeks WHERE lesson_id = ?"
  ).bind(lessonId).first();
  const weekNo = (maxRow && maxRow.n ? Number(maxRow.n) : 0) + 1;

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO curriculum_weeks (id, lesson_id, week_no, focus, activities, phonics, questions, notes, start_date, author, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    id, lessonId, weekNo,
    clean(body.focus, 200) || null,
    clean(body.activities, 4000) || null,
    clean(body.phonics, 2000) || null,
    clean(body.questions, 4000) || null,
    clean(body.notes, 4000) || null,
    cleanDate(body.start_date),
    clean(body.author, 60) || "anonymous",
    now
  ).run();

  return json({ ok: true, id, week_no: weekNo });
}

// Edit a week's fields. Any signed-in teacher may edit.
export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 60);
  if (!id) return json({ error: "missing id" }, 400);

  const existing = await env.DB.prepare("SELECT id FROM curriculum_weeks WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "not found" }, 404);

  // Only touch the fields the caller sent.
  const sets = [];
  const vals = [];
  const maybe = (key, col, val) => { if (key in body) { sets.push(col + " = ?"); vals.push(val); } };
  maybe("focus", "focus", clean(body.focus, 200) || null);
  maybe("activities", "activities", clean(body.activities, 4000) || null);
  maybe("phonics", "phonics", clean(body.phonics, 2000) || null);
  maybe("questions", "questions", clean(body.questions, 4000) || null);
  maybe("notes", "notes", clean(body.notes, 4000) || null);
  maybe("start_date", "start_date", cleanDate(body.start_date));
  if (!sets.length) return json({ ok: true });

  vals.push(id);
  await env.DB.prepare("UPDATE curriculum_weeks SET " + sets.join(", ") + " WHERE id = ?").bind(...vals).run();
  return json({ ok: true });
}

// Delete a week and its retro comments. Weeks are lightweight sub-items of a
// shared theme, so any signed-in teacher may remove one.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 60);
  if (!id) return json({ error: "missing id" }, 400);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM week_comments WHERE week_id = ?").bind(id),
    env.DB.prepare("DELETE FROM week_days WHERE week_id = ?").bind(id),
    env.DB.prepare("DELETE FROM curriculum_weeks WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}
