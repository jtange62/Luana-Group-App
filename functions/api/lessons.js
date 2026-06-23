import { json, verifyToken, bearer } from "./_helpers.js";

// List every lesson with its attached files. Search/filter is done client-side.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const lessonsRes = await env.DB.prepare(
    "SELECT * FROM lessons ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const lessons = lessonsRes.results || [];
  if (lessons.length === 0) return json({ lessons: [] });

  const ids = lessons.map((l) => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const filesRes = await env.DB.prepare(
    `SELECT * FROM lesson_files WHERE lesson_id IN (${placeholders}) ORDER BY created_at ASC`
  ).bind(...ids).all();

  const byLesson = {};
  (filesRes.results || []).forEach((f) => {
    (byLesson[f.lesson_id] = byLesson[f.lesson_id] || []).push({
      id: f.id, filename: f.filename, size: f.size, type: f.type,
    });
  });

  lessons.forEach((l) => { l.files = byLesson[l.id] || []; });
  return json({ lessons });
}
