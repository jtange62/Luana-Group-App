import { json, verifyToken, bearer } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const postsRes = await env.DB.prepare(
    "SELECT * FROM posts ORDER BY created_at DESC LIMIT 500"
  ).all();
  const posts = postsRes.results || [];

  if (posts.length === 0) return json({ posts: [] });

  const ids = posts.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const commentsRes = await env.DB.prepare(
    `SELECT * FROM comments WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`
  ).bind(...ids).all();

  const byPost = {};
  (commentsRes.results || []).forEach((c) => {
    (byPost[c.post_id] = byPost[c.post_id] || []).push({
      author: c.author, text: c.text, created_at: c.created_at,
    });
  });

  posts.forEach((p) => { p.comments = byPost[p.id] || []; });
  return json({ posts });
}
