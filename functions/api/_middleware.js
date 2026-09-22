import { json, sessionUser, verifyToken, bearer, safeEqual } from "./_helpers.js";

function requestId(request) {
  const supplied = request.headers.get("x-request-id") || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : crypto.randomUUID();
}

// Routes that do their own gating, because they run before or instead of a session.
const PUBLIC_PATHS = ["/api/login", "/api/health", "/api/account-setup"];

// Role policy, in one place. Anything not listed here is open to every signed-in
// staff member; these are the structural operations that should stay with an
// administrator. Resource-level ownership (a teacher may delete her own week
// note but not someone else's) lives in the routes via `requireOwner`.
const ADMIN_ONLY = {
  "/api/students": ["DELETE"],      // removing a child from the roster
  "/api/school-years": ["POST"],    // bulk-copying a roster or plans into a new year
  "/api/summer-weeks": ["POST", "PUT", "PATCH", "DELETE"], // school-wide term dates
  "/api/staff": ["GET", "POST", "PATCH", "DELETE"],        // also enforced in staff.js
};

function adminRequired(path, method) {
  const methods = ADMIN_ONLY[path];
  return !!methods && methods.includes(method);
}

export async function onRequest(context) {
  const id = requestId(context.request);
  context.data.requestId = id;
  try {
    const path = new URL(context.request.url).pathname;
    let request = context.request, user = null;

    // The daily-summary GitHub Action authenticates with its own token rather
    // than a staff session.
    const summaryService = path === "/api/summary" && request.method === "GET"
      && context.env?.SUMMARY_TOKEN
      && await safeEqual(bearer(request) || "", context.env.SUMMARY_TOKEN);

    if (!summaryService && !PUBLIC_PATHS.includes(path)) {
      if (context.env?.AUTH_MODE === "accounts") {
        user = await sessionUser(context.env, bearer(request));
        if (!user?.id) return json({ error: "unauthorized" }, 401);
        if (user.must_change && path !== "/api/account") {
          return json({ error: "Change your temporary password first.", password_change_required: true }, 403);
        }
        if (adminRequired(path, request.method) && user.role !== "admin") {
          return json({ error: "Administrator access required" }, 403);
        }
      } else if (!(await verifyToken(context.env, bearer(request)))) {
        // Legacy shared-password deployments are now guarded here too, rather
        // than relying solely on each route's own check.
        return json({ error: "unauthorized" }, 401);
      }
    }

    if (user?.id) {
      // Routes read the signed-in user from here instead of re-querying.
      context.data.user = user;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !["/api/account", "/api/staff"].includes(path)) {
        const headers = new Headers(request.headers), type = headers.get("content-type") || "";
        if (type.includes("application/json")) {
          let body;
          try { body = await request.clone().json(); } catch { return json({ error: "Invalid request" }, 400); }
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
          body.author = user.name; body.marked_by = user.name;
          request = new Request(request, { body: JSON.stringify(body) });
        } else if (type.includes("multipart/form-data")) {
          const form = await request.clone().formData();
          form.set("author", user.name);
          headers.delete("content-type");
          request = new Request(request, { headers, body: form });
        }
      }
    }

    const original = await context.next(request);
    if (user?.id && original.ok && !["GET", "HEAD", "OPTIONS"].includes(request.method) && path !== "/api/usage") {
      await context.env.DB.prepare("INSERT INTO staff_audit(id,staff_id,username,action,path,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.id, user.username, request.method, path, Date.now()).run();
    }
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
