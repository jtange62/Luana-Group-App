import { json, verifyToken, bearer, clean } from "./_helpers.js";

const MAX_FILE = 50 * 1024 * 1024;
const MAX_FILES = 20;

// Remove a single file from a post.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, postId, author } = body;
  if (!id || !postId) return json({ error: "missing fields" }, 400);

  const post = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "not found" }, 404);
  if (post.author !== clean(author, 60)) return json({ error: "forbidden" }, 403);

  const file = await env.DB.prepare("SELECT id FROM post_files WHERE id = ? AND post_id = ?").bind(id, postId).first();
  if (!file) return json({ error: "file not found" }, 404);

  try { await env.FILES.delete(id); } catch { /* ignore */ }
  await env.DB.prepare("DELETE FROM post_files WHERE id = ?").bind(id).run();

  return json({ ok: true });
}

// Append files to an existing post.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad request" }, 400); }

  const postId = clean(form.get("postId"), 40);
  const author = clean(form.get("author"), 60);
  if (!postId) return json({ error: "missing postId" }, 400);

  const post = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(postId).first();
  if (!post) return json({ error: "not found" }, 404);
  if (post.author !== author) return json({ error: "forbidden" }, 403);

  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (!files.length) return json({ ok: true });

  const countRow = await env.DB.prepare("SELECT COUNT(*) as n FROM post_files WHERE post_id = ?").bind(postId).first();
  const existing = countRow ? (countRow.n || 0) : 0;
  if (existing + files.length > MAX_FILES) return json({ error: "Too many files (max " + MAX_FILES + ")" }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE) return json({ error: '"' + f.name + '" is over 50 MB' }, 400);
  }

  const now = Date.now();
  for (const f of files) {
    const fileId = crypto.randomUUID();
    await env.FILES.put(fileId, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    await env.DB.prepare(
      "INSERT INTO post_files (id, post_id, filename, size, type, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(fileId, postId, clean(f.name, 255) || "file", f.size, f.type || null, now).run();
  }

  return json({ ok: true });
}
