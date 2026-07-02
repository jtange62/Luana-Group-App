import { json, verifyToken, bearer } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  // One round trip. Comments/files are scoped with a subselect rather than an
  // IN (?,?,...) list — D1 caps bound parameters at 100 per query, which a
  // 500-post id list would blow past.
  const recent = "SELECT id FROM posts ORDER BY created_at DESC LIMIT 500";
  const [postsRes, commentsRes, filesRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM posts ORDER BY created_at DESC LIMIT 500"),
    env.DB.prepare(`SELECT * FROM comments WHERE post_id IN (${recent}) ORDER BY created_at ASC`),
    env.DB.prepare(`SELECT * FROM post_files WHERE post_id IN (${recent}) ORDER BY created_at ASC`),
  ]);
  const posts = postsRes.results || [];
  if (posts.length === 0) return json({ posts: [] });

  const commentsByPost = {};
  (commentsRes.results || []).forEach((c) => {
    (commentsByPost[c.post_id] = commentsByPost[c.post_id] || []).push({
      author: c.author, text: c.text, created_at: c.created_at,
    });
  });

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
