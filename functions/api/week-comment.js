import { json, verifyToken, bearer, clean } from "./_helpers.js";

// Add a retro note to a curriculum week.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const weekId = clean(body.week_id, 60);
  const author = clean(body.author, 60) || "anonymous";
  const text = clean(body.text, 2000);
  if (!weekId || !text) return json({ error: "missing fields" }, 400);

  // Make sure the week exists before attaching a comment.
  const week = await env.DB.prepare("SELECT id FROM curriculum_weeks WHERE id = ?").bind(weekId).first();
  if (!week) return json({ error: "week not found" }, 404);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO week_comments (id, week_id, author, text, created_at) VALUES (?,?,?,?,?)"
  ).bind(id, weekId, author, text, Date.now()).run();

  return json({ ok: true, id });
}

// Delete a comment. Retro notes are shared working notes, so any signed-in
// teacher may remove one — same policy as week/block deletion.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 60);
  if (!id) return json({ error: "missing id" }, 400);

  await env.DB.prepare("DELETE FROM week_comments WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
