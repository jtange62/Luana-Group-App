import { json, verifyToken, bearer, clean } from "./_helpers.js";

async function getGoogleToken(env) {
  const sa = JSON.parse(env.GOOGLE_SA_KEY);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const b64url = (obj) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = b64url(header) + "." + b64url(payload);

  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const sigBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(signingInput));
  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signingInput + "." + encodedSig,
    }),
  });

  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error("Google auth failed");
  return access_token;
}

// POST { filename, mimeType, size }
// Returns { uploadUrl } — browser uploads directly to Google with this URL.
export async function onRequestPost({ request, env }) {
  if (!(await verifyToken(env, bearer(request)))) return json({ error: "unauthorized" }, 401);
  if (!env.GOOGLE_SA_KEY) return json({ error: "Drive not configured" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const filename = clean(body.filename, 255) || "upload";
  const mimeType = clean(body.mimeType, 100) || "application/octet-stream";
  const size = Number(body.size) || 0;

  let token;
  try { token = await getGoogleToken(env); }
  catch { return json({ error: "Google authentication failed — check GOOGLE_SA_KEY secret" }, 500); }

  const metadata = {
    name: filename,
    ...(env.DRIVE_FOLDER_ID ? { parents: [env.DRIVE_FOLDER_ID] } : {}),
  };

  const sessionRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        ...(size ? { "X-Upload-Content-Length": String(size) } : {}),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    return json({ error: "Drive session error: " + err }, 500);
  }

  const uploadUrl = sessionRes.headers.get("Location");
  if (!uploadUrl) return json({ error: "No upload URL from Drive" }, 500);

  return json({ uploadUrl });
}
