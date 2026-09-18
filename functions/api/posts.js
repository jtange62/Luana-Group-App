import { json, verifyToken, bearer } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 500);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 500;
  // ?placed=0 is the board's inbox: ideas that have not been filed anywhere yet.
  const unplacedOnly = url.searchParams.get("placed") === "0";
  const scope = unplacedOnly ? "placed_at IS NULL" : "";
  const category = url.searchParams.get("category") || "";
  if (category && !["curriculum", "events", "supplies", "general"].includes(category)) return json({ error: "invalid category" }, 400);
  const withCounts = url.searchParams.get("counts") === "1";
  const cursor = url.searchParams.get("before") || "";
  const parts = cursor.split("|");
  const cursorTime = cursor ? Number(parts[0]) : 0;
  const cursorId = cursor ? parts.slice(1).join("|") : "";
  if (cursor && (!Number.isFinite(cursorTime) || !cursorId)) return json({ error: "invalid cursor" }, 400);

  // Fetch one extra row to determine whether another page exists. Related rows
  // use the same subquery so D1 still handles this in one batch round trip.
  const fetchLimit = limit + 1;
  const clauses = [];
  if (scope) clauses.push(scope);
  if (category) clauses.push("category = ?");
  if (cursor) clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const tail = `${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const page = `SELECT id FROM posts${tail}`;
  const postsSql = `SELECT * FROM posts${tail}`;
  const bindings = cursor ? [cursorTime, cursorTime, cursorId, fetchLimit] : [fetchLimit];
  if (category) bindings.unshift(category);
  const statement = (sql) => env.DB.prepare(sql).bind(...bindings);
  const [postsRes, commentsRes, filesRes, itemsRes, countsRes] = await env.DB.batch([
    statement(postsSql),
    statement(`SELECT * FROM comments WHERE post_id IN (${page}) ORDER BY created_at ASC`),
    statement(`SELECT * FROM post_files WHERE post_id IN (${page}) ORDER BY created_at ASC`),
    statement(`SELECT * FROM post_items WHERE post_id IN (${page}) ORDER BY created_at ASC`),
    ...(withCounts ? [env.DB.prepare("SELECT COUNT(*) AS open_count FROM posts WHERE placed_at IS NULL")] : []),
  ]);
  const counts = withCounts ? { open_count: Number(countsRes?.results?.[0]?.open_count || 0) } : {};
  const rows = postsRes.results || [];
  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit);
  if (posts.length === 0) return json({ ...counts, posts: [], has_more: false, next_cursor: null });

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

  const itemsByPost = {};
  (itemsRes.results || []).forEach((i) => {
    (itemsByPost[i.post_id] = itemsByPost[i.post_id] || []).push({
      id: i.id, text: i.text, done: !!i.done,
    });
  });

  posts.forEach((p) => {
    p.comments = commentsByPost[p.id] || [];
    p.files = filesByPost[p.id] || [];
    p.items = itemsByPost[p.id] || [];
  });
  const last = posts[posts.length - 1];
  return json({ ...counts, posts, has_more: hasMore, next_cursor: hasMore ? `${last.created_at}|${last.id}` : null });
}
