import { json, verifyToken, bearer } from "./_helpers.js";

// List every lesson with its attached files. Search/filter is done client-side.
export async function onRequestGet({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  // One round trip; the files query scopes with a subselect instead of an
  // IN (?,?,...) id list, which would exceed D1's 100-bound-parameter cap.
  const recent = "SELECT id FROM lessons ORDER BY created_at DESC LIMIT 1000";
  const [lessonsRes, filesRes] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM lessons ORDER BY created_at DESC LIMIT 1000"),
    env.DB.prepare(`SELECT * FROM lesson_files WHERE lesson_id IN (${recent}) ORDER BY created_at ASC`),
  ]);
  const lessons = lessonsRes.results || [];
  if (lessons.length === 0) return json({ lessons: [] });

  const byLesson = {};
  (filesRes.results || []).forEach((f) => {
    (byLesson[f.lesson_id] = byLesson[f.lesson_id] || []).push({
      id: f.id, filename: f.filename, size: f.size, type: f.type,
    });
  });

  lessons.forEach((l) => { l.files = byLesson[l.id] || []; });
  return json({ lessons });
}
