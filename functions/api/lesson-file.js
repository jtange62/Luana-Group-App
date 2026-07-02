import { json, verifyToken, bearer, clean } from "./_helpers.js";

const MAX_FILE = 50 * 1024 * 1024;
const MAX_FILES = 20;

// Remove a single file from a lesson.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, lessonId, author } = body;
  if (!id || !lessonId) return json({ error: "missing fields" }, 400);

  // Any signed-in teacher may edit any lesson, including removing its files.
  const lesson = await env.DB.prepare("SELECT author FROM lessons WHERE id = ?").bind(lessonId).first();
  if (!lesson) return json({ error: "not found" }, 404);

  const file = await env.DB.prepare("SELECT id FROM lesson_files WHERE id = ? AND lesson_id = ?").bind(id, lessonId).first();
  if (!file) return json({ error: "file not found" }, 404);

  try { await env.FILES.delete(id); } catch { /* ignore */ }
  await env.DB.prepare("DELETE FROM lesson_files WHERE id = ?").bind(id).run();

  return json({ ok: true });
}

// Append files to an existing lesson.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad request" }, 400); }

  const lessonId = clean(form.get("lessonId"), 40);
  const author = clean(form.get("author"), 60);
  if (!lessonId) return json({ error: "missing lessonId" }, 400);

  // Any signed-in teacher may edit any lesson, including attaching files.
  const lesson = await env.DB.prepare("SELECT author FROM lessons WHERE id = ?").bind(lessonId).first();
  if (!lesson) return json({ error: "not found" }, 404);

  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (!files.length) return json({ ok: true });

  const countRow = await env.DB.prepare("SELECT COUNT(*) as n FROM lesson_files WHERE lesson_id = ?").bind(lessonId).first();
  const existing = countRow ? (countRow.n || 0) : 0;
  if (existing + files.length > MAX_FILES) return json({ error: "Too many files (max " + MAX_FILES + ")" }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE) return json({ error: '"' + f.name + '" is over 50 MB' }, 400);
  }

  const now = Date.now();
  const inserts = [];
  for (const f of files) {
    const fileId = crypto.randomUUID();
    await env.FILES.put(fileId, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    inserts.push(env.DB.prepare(
      "INSERT INTO lesson_files (id, lesson_id, filename, size, type, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(fileId, lessonId, clean(f.name, 255) || "file", f.size, f.type || null, now));
  }
  if (inserts.length) await env.DB.batch(inserts);

  return json({ ok: true });
}
