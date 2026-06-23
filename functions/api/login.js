import { json, makeToken, clean } from "./_helpers.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const pw = clean(body.password, 200);
  if (!pw || pw !== env.STAFF_PASSWORD) {
    return json({ error: "wrong password" }, 401);
  }
  const token = await makeToken(env);
  return json({ token });
}
