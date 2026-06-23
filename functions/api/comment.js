import { json, verifyToken, bearer, clean } from "./_helpers.js";

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const postId = clean(body.post_id, 64);
  const author = clean(body.author, 60) || "anonymous";
  const text = clean(body.text, 2000);
  if (!postId || !text) return json({ error: "missing fields" }, 400);

  // Make sure the post exists before attaching a comment.
  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "post not found" }, 404);

  await env.DB.prepare(
    "INSERT INTO comments (id, post_id, author, text, created_at) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), postId, author, text, Date.now()).run();

  return json({ ok: true });
}
