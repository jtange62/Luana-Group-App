import { json } from "./_helpers.js";

function requestId(request) {
  const supplied = request.headers.get("x-request-id") || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export async function onRequest(context) {
  const id = requestId(context.request);
  context.data.requestId = id;
  try {
    const original = await context.next();
    const response = new Response(original.body, original);
    response.headers.set("x-request-id", id);
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "api_error",
      request_id: id,
      method: context.request.method,
      path: new URL(context.request.url).pathname,
      error_name: error && error.name ? error.name : "Error",
    }));
    const response = json({ error: "internal error", request_id: id }, 500);
    response.headers.set("x-request-id", id);
    return response;
  }
}

