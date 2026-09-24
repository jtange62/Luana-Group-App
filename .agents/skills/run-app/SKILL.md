---
name: run-app
description: Launch the Luana Group App locally with wrangler and authenticate past the staff-password login so pages and APIs can be tested end-to-end.
---

# Running and testing the Luana Group App locally

Cloudflare Pages app (static `public/` + `functions/api/*` + D1 + R2). No package.json — everything runs through `npx wrangler`.

## Start the dev server

```
npx wrangler pages dev public
```

Run it in the background; it serves on http://localhost:8788. Secrets come from `.dev.vars`
(`STAFF_PASSWORD = "test"`, plus a local `SESSION_SECRET`).

If a local D1 query fails with a missing table/column, apply migrations to the local DB first:

```
npx wrangler d1 execute luana-board --local --file schema.sql
npx wrangler d1 execute luana-board --local --file migrations/<file>.sql
```

(`schema.sql` is idempotent-ish for a fresh DB; for an existing local DB apply only the missing
numbered migrations, in order.)

## Getting past the login

Every tool page requires a signed-in session. Don't drive the login form — authenticate directly:

1. `POST http://localhost:8788/api/login` with JSON body `{"password":"test"}` → returns `{"token":"..."}`.
2. For **API testing**, send that token as `Authorization: Bearer <token>` on `/api/*` requests.
3. For **browser/page testing**, before loading any tool page set localStorage on the origin:
   - `luana_token` = the token
   - `luana_name` = any display name, e.g. `"test-runner"`

   `public/shared-auth.js` reads those keys; pages redirect to `/` when `luana_token` is absent.

Rate limit caution: `/api/login` returns 429 after 5 *failed* attempts from one IP in 10 minutes
(`login_attempts` table). Successful logins don't count, so always send the correct password from
`.dev.vars` rather than guessing.

## Driving the UI headlessly

Playwright is available via npx (no repo dependency; the repo has no package.json — keep it
that way). Install `playwright-core` in the session scratchpad and launch the system Chrome:

```js
const { chromium } = require("playwright-core");
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
await page.addInitScript(([t]) => {
  localStorage.setItem("luana_token", t);
  localStorage.setItem("luana_name", "ui-tester");
}, [tokenFromApiLogin]);
```

Gotchas: modals toggle the `hidden` attribute, so wait for close with
`waitForSelector("#modal[hidden]", { state: "attached" })` (default waits for visible and
times out); native `confirm()` dialogs need `page.once("dialog", d => d.accept())`;
`<input type=date>` needs `page.fill` + `page.dispatchEvent(sel, "change")`.

Clean up any rows you seed (the local D1 persists between runs):
`npx wrangler d1 execute luana-board --local --command "DELETE FROM ... WHERE author='tester'"`.

## Never test against production

The deployed site (main branch auto-deploys) uses the real staff password and real data. All
automated testing happens against `wrangler pages dev` locally.
