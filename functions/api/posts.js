import { json, verifyToken, bearer } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 500);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 500;
  const cursor = url.searchParams.get("before") || "";
  const parts = cursor.split("|");
  const cursorTime = cursor ? Number(parts[0]) : 0;
  const cursorId = cursor ? parts.slice(1).join("|") : "";
  if (cursor && (!Number.isFinite(cursorTime) || !cursorId)) return json({ error: "invalid cursor" }, 400);

  // Fetch one extra row to determine whether another page exists. Related rows
  // use the same subquery so D1 still handles this in one batch round trip.
  const fetchLimit = limit + 1;
  const page = cursor
    ? "SELECT id FROM posts WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?"
    : "SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT ?";
  const postsSql = cursor
    ? "SELECT * FROM posts WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?"
    : "SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT ?";
  const bindings = cursor ? [cursorTime, cursorTime, cursorId, fetchLimit] : [fetchLimit];
  const statement = (sql) => env.DB.prepare(sql).bind(...bindings);
  const [postsRes, commentsRes, filesRes] = await env.DB.batch([
    statement(postsSql),
    statement(`SELECT * FROM comments WHERE post_id IN (${page}) ORDER BY created_at ASC`),
    statement(`SELECT * FROM post_files WHERE post_id IN (${page}) ORDER BY created_at ASC`),
  ]);
  const rows = postsRes.results || [];
  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit);
  if (posts.length === 0) return json({ posts: [], has_more: false, next_cursor: null });

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
  const last = posts[posts.length - 1];
  return json({ posts, has_more: hasMore, next_cursor: hasMore ? `${last.created_at}|${last.id}` : null });
}
