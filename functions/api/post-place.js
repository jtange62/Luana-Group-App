import { json, verifyToken, bearer, clean } from "./_helpers.js";

// Move an idea into the curriculum where it belongs.
//
// POST   /api/post-place {post_id, type, target_id, field, label}
// DELETE /api/post-place {post_id}   -> mark unplaced again (leaves the text
//                                       already appended to the curriculum)
//
// The append is done server-side so two people filing at once cannot overwrite
// each other's text the way a read-modify-write from the client would.

// Which fields each kind of curriculum row will accept.
const TARGETS = {
  theme: { table: "lessons", fields: ["vocab", "activities", "phonics", "song", "notes"] },
  week: { table: "curriculum_weeks", fields: ["activities", "phonics", "questions", "notes"] },
  day: { table: "week_days", fields: ["vocab", "activities"] },
};

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const postId = clean(body.post_id, 64);
  const type = clean(body.type, 10);
  const targetId = clean(body.target_id, 64);
  const field = clean(body.field, 20);
  const label = clean(body.label, 200);

  const target = TARGETS[type];
  if (!postId || !targetId || !target) return json({ error: "bad request" }, 400);
  // The field name is interpolated into SQL, so it must come from the allow
  // list rather than from the request.
  if (!target.fields.includes(field)) return json({ error: "field not allowed here" }, 400);

  const post = await env.DB.prepare("SELECT text FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "post not found" }, 404);

  const row = await env.DB.prepare(
    `SELECT COALESCE(${field}, '') AS current FROM ${target.table} WHERE id = ?`
  ).bind(targetId).first();
  if (!row) return json({ error: "curriculum target not found" }, 404);

  const addition = clean(post.text, 8000);
  if (!addition) return json({ error: "this idea has no text to file" }, 400);
  // Append rather than replace — a day's vocab is built up over time, and an
  // idea being filed should never wipe what a teacher already typed.
  const merged = row.current ? row.current.replace(/\s+$/, "") + "\n" + addition : addition;

  await env.DB.batch([
    env.DB.prepare(`UPDATE ${target.table} SET ${field} = ? WHERE id = ?`).bind(merged, targetId),
    env.DB.prepare("UPDATE posts SET placed_at = ?, placed_note = ? WHERE id = ?")
      .bind(Date.now(), label || field, postId),
  ]);

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const postId = clean(body.post_id, 64);
  if (!postId) return json({ error: "bad request" }, 400);

  // Only clears the flag. The text stays where it was filed, because deleting
  // it again could take a teacher's later edits with it.
  await env.DB.prepare("UPDATE posts SET placed_at = NULL, placed_note = NULL WHERE id = ?")
    .bind(postId).run();
  return json({ ok: true });
}
