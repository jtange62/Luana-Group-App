import { json, verifyToken, bearer } from "../_helpers.js";

// Serve an uploaded file from R2, gated by the same staff token as everything else.
export async function onRequestGet({ request, env, params }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  const id = params.id;
  // Files come from either the lesson library or the website inbox.
  const meta = await env.DB.prepare(
    `SELECT filename, type FROM lesson_files WHERE id = ?
     UNION ALL SELECT filename, type FROM submission_files WHERE id = ? LIMIT 1`
  ).bind(id, id).first();
  if (!meta) return json({ error: "not found" }, 404);

  const obj = await env.FILES.get(id);
  if (!obj) return json({ error: "not found" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", meta.type || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Disposition", 'inline; filename="' + String(meta.filename).replace(/["\r\n]/g, "") + '"');
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(obj.body, { headers });
}
