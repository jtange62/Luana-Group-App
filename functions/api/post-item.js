import { json, verifyToken, bearer, clean } from "./_helpers.js";

// Checkable items under a post — the supplies to gather, the steps to build
// something. This is what "project development" looks like here: an idea that
// grew a list, rather than a separate tool with its own structure to maintain.
//
// POST   /api/post-item {post_id, text}   -> add (accepts multi-line text)
// PATCH  /api/post-item {id, done}        -> tick / untick
// DELETE /api/post-item {id}              -> remove

const MAX_ITEMS = 60;

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const postId = clean(body.post_id, 64);
  if (!postId) return json({ error: "bad request" }, 400);

  // One line per item, so a list can be pasted in whole.
  const texts = clean(body.text, 4000).split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (!texts.length) return json({ error: "nothing to add" }, 400);

  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "post not found" }, 404);

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM post_items WHERE post_id = ?")
    .bind(postId).first();
  if ((countRow ? countRow.n : 0) + texts.length > MAX_ITEMS) {
    return json({ error: "That's more than " + MAX_ITEMS + " items." }, 400);
  }

  const now = Date.now();
  await env.DB.batch(texts.map((text, i) => env.DB.prepare(
    "INSERT INTO post_items (id, post_id, text, done, created_at) VALUES (?,?,?,0,?)"
  ).bind(crypto.randomUUID(), postId, clean(text, 300), now + i)));

  return json({ ok: true, added: texts.length });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 64);
  if (!id) return json({ error: "bad request" }, 400);
  await env.DB.prepare("UPDATE post_items SET done = ? WHERE id = ?")
    .bind(body.done ? 1 : 0, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const id = clean(body.id, 64);
  if (!id) return json({ error: "bad request" }, 400);
  await env.DB.prepare("DELETE FROM post_items WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
