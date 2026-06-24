import { json, verifyToken, bearer, clean } from "./_helpers.js";

const MAX_FILE = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 8;
const PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];

function normalizeLink(raw) {
  const v = clean(raw, 1000);
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : "https://" + v;
}

function cleanProgram(raw) {
  const v = clean(raw, 40);
  return PROGRAMS.includes(v) ? v : null;
}

function cleanMonth(raw) {
  const n = parseInt(clean(raw, 2), 10);
  return n >= 1 && n <= 12 ? String(n) : null;
}

// Create a lesson. Sent as multipart/form-data so files can ride along.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad request" }, 400); }

  const title = clean(form.get("title"), 200);
  if (!title) return json({ error: "title required" }, 400);
  const author = clean(form.get("author"), 60) || "anonymous";
  const program = cleanProgram(form.get("program"));
  const month = cleanMonth(form.get("month"));
  const notes = clean(form.get("notes"), 8000) || null;
  const link = normalizeLink(form.get("link"));
  const tags = clean(form.get("tags"), 300) || null;

  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (files.length > MAX_FILES) return json({ error: "Too many files (max " + MAX_FILES + ")" }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE) return json({ error: '"' + f.name + '" is over 25 MB' }, 400);
  }

  const lessonId = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    "INSERT INTO lessons (id, title, author, program, month, notes, link_url, tags, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(lessonId, title, author, program, month, notes, link, tags, now).run();

  for (const f of files) {
    const fileId = crypto.randomUUID();
    await env.FILES.put(fileId, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    await env.DB.prepare(
      "INSERT INTO lesson_files (id, lesson_id, filename, size, type, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(fileId, lessonId, clean(f.name, 255) || "file", f.size, f.type || null, now).run();
  }

  return json({ ok: true, id: lessonId });
}

// Edit a lesson's text fields (title/notes/link/tags). Files are unchanged.
export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, author } = body;
  if (!id) return json({ error: "missing id" }, 400);
  const title = clean(body.title, 200);
  if (!title) return json({ error: "title required" }, 400);

  const lesson = await env.DB.prepare("SELECT author FROM lessons WHERE id = ?").bind(id).first();
  if (!lesson) return json({ error: "not found" }, 404);
  if (lesson.author !== author) return json({ error: "forbidden" }, 403);

  await env.DB.prepare(
    "UPDATE lessons SET title = ?, program = ?, month = ?, notes = ?, link_url = ?, tags = ? WHERE id = ?"
  ).bind(
    title,
    cleanProgram(body.program),
    cleanMonth(body.month),
    clean(body.notes, 8000) || null,
    normalizeLink(body.link),
    clean(body.tags, 300) || null,
    id
  ).run();

  return json({ ok: true });
}

// Delete a lesson and all of its uploaded files.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, author } = body;
  if (!id) return json({ error: "missing id" }, 400);

  const lesson = await env.DB.prepare("SELECT author FROM lessons WHERE id = ?").bind(id).first();
  if (!lesson) return json({ error: "not found" }, 404);
  if (lesson.author !== author) return json({ error: "forbidden" }, 403);

  const filesRes = await env.DB.prepare("SELECT id FROM lesson_files WHERE lesson_id = ?").bind(id).all();
  for (const f of (filesRes.results || [])) {
    try { await env.FILES.delete(f.id); } catch { /* ignore */ }
  }
  await env.DB.prepare("DELETE FROM lesson_files WHERE lesson_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(id).run();

  return json({ ok: true });
}
