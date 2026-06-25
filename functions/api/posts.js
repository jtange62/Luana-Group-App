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

  const commentsByPost = {};
  (commentsRes.results || []).forEach((c) => {
    (commentsByPost[c.post_id] = commentsByPost[c.post_id] || []).push({
      author: c.author, text: c.text, created_at: c.created_at,
    });
  });

  const filesRes = await env.DB.prepare(
    `SELECT * FROM post_files WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`
  ).bind(...ids).all();

  const filesByPost = {};
  (filesRes.results || []).forEach((f) => {
    (filesByPost[f.post_id] = filesByPost[f.post_id] || []).push({
      id: f.id, filename: f.filename, size: f.size, type: f.type,
    });
  });

  posts.forEach((p) => {
    p.comments = commentsByPost[p.id] || [];
    p.files = filesByPost[p.id] || [];
  });
  return json({ posts });
}
