import { json, verifyToken, bearer } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  if (!["all", "new", "done"].includes(status)) return json({ error: "invalid status" }, 400);
  const requestedLimit = Number(url.searchParams.get("limit") || 1000);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 1000)) : 1000;
  const cursor = url.searchParams.get("before") || "";
  const parts = cursor.split("|");
  const cursorTime = cursor ? Number(parts[0]) : 0;
  const cursorId = cursor ? parts.slice(1).join("|") : "";
  if (cursor && (!Number.isFinite(cursorTime) || !cursorId)) return json({ error: "invalid cursor" }, 400);

  const conditions = [];
  const bindings = [];
  if (status !== "all") { conditions.push("status = ?"); bindings.push(status); }
  if (cursor) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursorTime, cursorTime, cursorId);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const fetchLimit = limit + 1;
  bindings.push(fetchLimit);
  const page = `SELECT id FROM submissions${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
  const statement = (sql) => env.DB.prepare(sql).bind(...bindings);
  const [subsRes, filesRes, countsRes] = await env.DB.batch([
    statement(`SELECT * FROM submissions${where} ORDER BY created_at DESC, id DESC LIMIT ?`),
    statement(`SELECT * FROM submission_files WHERE submission_id IN (${page}) ORDER BY created_at ASC`),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM submissions GROUP BY status"),
  ]);

  const rows = subsRes.results || [];
  const hasMore = rows.length > limit;
  const submissions = rows.slice(0, limit);
  const bySub = {};
  (filesRes.results || []).forEach((file) => {
    (bySub[file.submission_id] = bySub[file.submission_id] || []).push({
      id: file.id, filename: file.filename, size: file.size, type: file.type,
    });
  });
  submissions.forEach((submission) => { submission.files = bySub[submission.id] || []; });

  const counts = { new: 0, done: 0, all: 0 };
  (countsRes.results || []).forEach((row) => {
    if (row.status === "new" || row.status === "done") counts[row.status] = Number(row.n) || 0;
  });
  counts.all = counts.new + counts.done;
  const last = submissions[submissions.length - 1];
  return json({
    submissions,
    counts,
    has_more: hasMore,
    next_cursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  });
}
