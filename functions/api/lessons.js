import { json, verifyToken, bearer, clean } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const program = clean(url.searchParams.get("program"), 40);
  const month = clean(url.searchParams.get("month"), 2);
  const query = clean(url.searchParams.get("q"), 200).toLowerCase();
  const id = clean(url.searchParams.get("id"), 64);
  const requestedLimit = Number(url.searchParams.get("limit") || 1000);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 1000)) : 1000;
  const cursor = url.searchParams.get("before") || "";
  const parts = cursor.split("|");
  const cursorTime = cursor ? Number(parts[0]) : 0;
  const cursorId = cursor ? parts.slice(1).join("|") : "";
  if (cursor && (!Number.isFinite(cursorTime) || !cursorId)) return json({ error: "invalid cursor" }, 400);

  const conditions = [];
  const bindings = [];
  if (id) { conditions.push("l.id = ?"); bindings.push(id); }
  if (program && program !== "all") { conditions.push("l.program = ?"); bindings.push(program); }
  if (month && month !== "all") { conditions.push("CAST(l.month AS TEXT) = ?"); bindings.push(month); }
  if (query) {
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(`(LOWER(COALESCE(l.title,'')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(l.notes,'')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(l.tags,'')) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM lesson_files sf WHERE sf.lesson_id = l.id AND LOWER(sf.filename) LIKE ? ESCAPE '\\'))`);
    bindings.push(like, like, like, like);
  }
  if (cursor) {
    conditions.push("(l.created_at < ? OR (l.created_at = ? AND l.id < ?))");
    bindings.push(cursorTime, cursorTime, cursorId);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const fetchLimit = id ? 1 : limit + 1;
  bindings.push(fetchLimit);
  const page = `SELECT l.id FROM lessons l${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;
  const statement = (sql) => env.DB.prepare(sql).bind(...bindings);
  const [lessonsRes, filesRes] = await env.DB.batch([
    statement(`SELECT l.* FROM lessons l${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`),
    statement(`SELECT * FROM lesson_files WHERE lesson_id IN (${page}) ORDER BY created_at ASC`),
  ]);
  const rows = lessonsRes.results || [];
  const hasMore = !id && rows.length > limit;
  const lessons = rows.slice(0, limit);
  const byLesson = {};
  (filesRes.results || []).forEach((file) => {
    (byLesson[file.lesson_id] = byLesson[file.lesson_id] || []).push({
      id: file.id, filename: file.filename, size: file.size, type: file.type,
    });
  });
  lessons.forEach((lesson) => { lesson.files = byLesson[lesson.id] || []; });
  const last = lessons[lessons.length - 1];
  return json({ lessons, has_more: hasMore, next_cursor: hasMore && last ? `${last.created_at}|${last.id}` : null });
}
