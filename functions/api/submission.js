import { json, verifyToken, bearer, clean } from "./_helpers.js";

const MAX_FILE = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 10;
const TYPES = ["Photo", "Newsletter", "Document", "Request", "Suggestion", "Other"];

function cleanType(raw) {
  const v = clean(raw, 30);
  return TYPES.includes(v) ? v : "Other";
}

// Create a submission (multipart/form-data so files ride along).
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad request" }, 400); }

  const author = clean(form.get("author"), 60) || "anonymous";
  const type = cleanType(form.get("type"));
  const title = clean(form.get("title"), 200) || null;
  const notes = clean(form.get("notes"), 8000) || null;

  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (!title && !notes && files.length === 0) return json({ error: "Add a note or a file." }, 400);
  if (files.length > MAX_FILES) return json({ error: "Too many files (max " + MAX_FILES + ")" }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE) return json({ error: '"' + f.name + '" is over 25 MB' }, 400);
  }

  const subId = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    "INSERT INTO submissions (id, author, type, title, notes, status, created_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(subId, author, type, title, notes, "new", now).run();

  for (const f of files) {
    const fileId = crypto.randomUUID();
    await env.FILES.put(fileId, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    await env.DB.prepare(
      "INSERT INTO submission_files (id, submission_id, filename, size, type, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(fileId, subId, clean(f.name, 255) || "file", f.size, f.type || null, now).run();
  }

  return json({ ok: true, id: subId });
}

// Toggle status (new <-> done).
export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);
  const status = body.status === "done" ? "done" : "new";

  await env.DB.prepare("UPDATE submissions SET status = ? WHERE id = ?").bind(status, body.id).run();
  return json({ ok: true });
}

// Delete a submission and its files.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!body.id) return json({ error: "missing id" }, 400);

  const filesRes = await env.DB.prepare("SELECT id FROM submission_files WHERE submission_id = ?").bind(body.id).all();
  for (const f of (filesRes.results || [])) {
    try { await env.FILES.delete(f.id); } catch { /* ignore */ }
  }
  await env.DB.prepare("DELETE FROM submission_files WHERE submission_id = ?").bind(body.id).run();
  await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(body.id).run();

  return json({ ok: true });
}
