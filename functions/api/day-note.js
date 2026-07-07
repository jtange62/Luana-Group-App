import { json, verifyToken, bearer, clean } from "./_helpers.js";

function cleanDate(raw) {
  const v = clean(raw, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Pin (or update) a one-off note on a block for a specific date. A block has
// at most one note per date — UNIQUE(block_id, date) makes this an upsert.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const blockId = clean(body.block_id, 60);
  if (!blockId) return json({ error: "missing block_id" }, 400);
  const date = cleanDate(body.date);
  if (!date) return json({ error: "valid date required" }, 400);
  const text = clean(body.text, 2000);
  if (!text) return json({ error: "note text required" }, 400);

  const block = await env.DB.prepare("SELECT id FROM schedule_blocks WHERE id = ?").bind(blockId).first();
  if (!block) return json({ error: "block not found" }, 404);

  await env.DB.prepare(
    "INSERT INTO day_block_notes (id, block_id, date, text, author, created_at) VALUES (?,?,?,?,?,?) " +
    "ON CONFLICT(block_id, date) DO UPDATE SET text = excluded.text, author = excluded.author"
  ).bind(
    crypto.randomUUID(), blockId, date, text,
    clean(body.author, 60) || "anonymous",
    Date.now()
  ).run();

  return json({ ok: true });
}

// Remove the note on a block for a date.
export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const blockId = clean(body.block_id, 60);
  const date = cleanDate(body.date);
  if (!blockId || !date) return json({ error: "missing block_id or date" }, 400);

  await env.DB.prepare("DELETE FROM day_block_notes WHERE block_id = ? AND date = ?").bind(blockId, date).run();
  return json({ ok: true });
}
