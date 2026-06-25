import { json, verifyToken, bearer, clean } from "./_helpers.js";

const CATEGORIES = ["curriculum", "events", "supplies", "general"];
const MAX_FILE = 50 * 1024 * 1024;
const MAX_FILES = 20;

export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "bad request" }, 400); }

  const category = CATEGORIES.includes(clean(form.get("category"), 20)) ? clean(form.get("category"), 20) : "general";
  const author = clean(form.get("author"), 60) || "anonymous";
  const text = clean(form.get("text"), 4000);
  if (!text) return json({ error: "empty" }, 400);

  const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (files.length > MAX_FILES) return json({ error: "Too many files (max " + MAX_FILES + ")" }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE) return json({ error: '"' + f.name + '" is over 50 MB' }, 400);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  // Unfurl the link if one was detected. Failures are non-fatal — we just skip the preview.
  let link = { url: null, title: null, desc: null, image: null, domain: null };
  const linkVal = clean(form.get("link"), 1000);
  if (linkVal) {
    try { link = await unfurl(linkVal); } catch { /* ignore */ }
  }

  await env.DB.prepare(
    `INSERT INTO posts (id, category, author, text, created_at, link_url, link_title, link_desc, link_image, link_domain)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, category, author, text, now,
    link.url, link.title, link.desc, link.image, link.domain
  ).run();

  for (const f of files) {
    const fileId = crypto.randomUUID();
    await env.FILES.put(fileId, await f.arrayBuffer(), {
      httpMetadata: { contentType: f.type || "application/octet-stream" },
    });
    await env.DB.prepare(
      "INSERT INTO post_files (id, post_id, filename, size, type, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(fileId, id, clean(f.name, 255) || "file", f.size, f.type || null, now).run();
  }

  return json({ ok: true, id });
}

export async function onRequestPatch({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, author, text } = body;
  if (!id) return json({ error: "missing id" }, 400);
  const newText = clean(text, 4000);
  if (!newText) return json({ error: "empty" }, 400);

  const post = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "not found" }, 404);
  if (post.author !== author) return json({ error: "forbidden" }, 403);

  await env.DB.prepare("UPDATE posts SET text = ? WHERE id = ?").bind(newText, id).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const { id, author } = body;
  if (!id) return json({ error: "missing id" }, 400);

  const post = await env.DB.prepare("SELECT author FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "not found" }, 404);
  if (post.author !== author) return json({ error: "forbidden" }, 403);

  const filesRes = await env.DB.prepare("SELECT id FROM post_files WHERE post_id = ?").bind(id).all();
  for (const f of (filesRes.results || [])) {
    try { await env.FILES.delete(f.id); } catch { /* ignore */ }
  }
  await env.DB.prepare("DELETE FROM post_files WHERE post_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();

  return json({ ok: true });
}

async function unfurl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return blank(); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return blank();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let html = "";
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "LuanaBoard/1.0 (+link preview)" },
      redirect: "follow",
    });
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) {
      // Direct image link → just show it as the thumbnail.
      if (type.startsWith("image/")) {
        return { url: url.toString(), title: url.hostname, desc: null, image: url.toString(), domain: url.hostname };
      }
      return { url: url.toString(), title: url.hostname, desc: null, image: null, domain: url.hostname };
    }
    // Read only the first ~100KB — meta tags live in <head>.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    while (received < 100000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      received += value.length;
      if (html.includes("</head>")) break;
    }
    reader.cancel().catch(() => {});
  } finally {
    clearTimeout(timer);
  }

  const meta = (prop) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
      "i"
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`,
      "i"
    );
    const m = html.match(re) || html.match(re2);
    return m ? decodeEntities(m[1]) : null;
  };
  const titleTag = (() => {
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return m ? decodeEntities(m[1].trim()) : null;
  })();

  let image = meta("og:image") || meta("twitter:image");
  if (image) { try { image = new URL(image, url).toString(); } catch {} }

  return {
    url: url.toString(),
    title: (meta("og:title") || meta("twitter:title") || titleTag || url.hostname).slice(0, 200),
    desc: (meta("og:description") || meta("twitter:description") || meta("description") || "").slice(0, 300) || null,
    image: image || null,
    domain: url.hostname.replace(/^www\./, ""),
  };

  function blank() {
    return { url: null, title: null, desc: null, image: null, domain: null };
  }
}

function blank() {
  return { url: null, title: null, desc: null, image: null, domain: null };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}
