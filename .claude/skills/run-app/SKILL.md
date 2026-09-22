---
name: run-app
description: Launch the Luana Group App locally with wrangler and authenticate past the staff login so pages and APIs can be tested end-to-end.
---

# Running and testing the Luana Group App locally

Cloudflare Pages app: static `public/` + `functions/api/*` + D1 + R2. There **is** a
`package.json` — it holds the test scripts and the two dev dependencies the browser suites
need (`playwright-core`, `@axe-core/playwright`). Run `npm install` once. Wrangler itself is
not a dependency; it runs through `npx wrangler`.

## Start the dev server

```
npx wrangler pages dev public
```

Run it in the background; it serves on http://localhost:8788. Secrets come from `.dev.vars`
(`STAFF_PASSWORD`, `SESSION_SECRET`, and `STAFF_SETUP_TOKEN` if you need to bootstrap an
administrator locally).

If a local D1 query fails with a missing table/column, apply the schema to the local DB:

```
npx wrangler d1 execute luana-board --local --file schema.sql
npx wrangler d1 execute luana-board --local --file migrations/<file>.sql
```

`schema.sql` is the canonical fresh install and already contains every migration; the numbered
files in `migrations/` only matter for upgrading a database that predates them.

## Getting past the login

`wrangler.toml` sets `AUTH_MODE = "accounts"`, so sign-in needs a username **and** a password.

**Accounts mode (the default).** Create a local administrator once:

1. Add `STAFF_SETUP_TOKEN = "any-local-string"` to `.dev.vars` and restart the server.
2. `POST /api/account-setup` with `{"username":"jtange","password":"<14+ chars>","setup_token":"<that string>"}`.
3. New accounts start with `must_change = 1`, which blocks every route except `/api/account`.
   For testing, clear it:
   `npx wrangler d1 execute luana-board --local --command "UPDATE staff_accounts SET must_change=0"`.
4. `POST /api/login` with `{"username":..., "password":...}` → `{"token":"..."}`.

**Shared-password mode.** Start the server with `--binding AUTH_MODE=shared` and
`POST /api/login` with just `{"password":"test"}`. This is what `scripts/browser-smoke.mjs` uses.

Then:
- For **API testing**, send the token as `Authorization: Bearer <token>`.
- For **browser/page testing**, set localStorage on the origin before loading a tool page:
  `luana_token` = the token, `luana_name` = any display name. `public/shared-auth.js` reads
  those keys; pages redirect to `/` when `luana_token` is absent.

Rate limit caution: `/api/login` returns 429 after 5 *failed* attempts from one IP in 10 minutes
(`login_attempts` table). Successful logins don't count, so always send the correct password.

## Authorization

`functions/api/_middleware.js` is the single enforcement point. It rejects unauthenticated calls
in **both** auth modes, applies the `ADMIN_ONLY` policy table (roster deletion, school-year
copies, term dates, staff management), and puts the signed-in user on `context.data.user`.
Routes that need row-level ownership call `requireOwner(context, {table, id})` from
`_helpers.js`, which lets admins through and otherwise matches `author` against the session
name. Routes also keep their own `verifyToken` guard as deliberate defence-in-depth.

## Running the checks

```
npm run check       # syntax scan + node --test
npm run check:all   # the above, plus both Playwright suites
```

Both browser suites resolve Chrome from `LUANA_CHROME_PATH` first, so on a machine without
Chrome in a standard location, set it:

```
LUANA_CHROME_PATH=/path/to/chrome npm run check:all
```

`scripts/browser-smoke.mjs` asserts against a **clean** local D1 (for example, that no closure
is visible for a class that has none). If you have been seeding demo data into
`.wrangler/state`, clear those tables first or the suite will fail on data, not on code.
`scripts/browser-accounts.mjs` is isolated — it uses its own `--persist-to` directory.

## Driving the UI headlessly

```js
const { chromium } = require("playwright-core");
const browser = await chromium.launch({
  executablePath: process.env.LUANA_CHROME_PATH, // or a system Chrome/Chromium path
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(([t]) => {
  localStorage.setItem("luana_token", t);
  localStorage.setItem("luana_name", "ui-tester");
}, [tokenFromApiLogin]);
```

Gotchas: modals toggle the `hidden` attribute, so wait for close with
`waitForSelector("#modal[hidden]", { state: "attached" })` (the default waits for visible and
times out); native `confirm()` dialogs need `page.once("dialog", d => d.accept())`;
`<input type=date>` needs `page.fill` + `page.dispatchEvent(sel, "change")`.

Clean up any rows you seed — the local D1 persists between runs:
`npx wrangler d1 execute luana-board --local --command "DELETE FROM ... WHERE author='tester'"`.

## Never test against production

The deployed site (main branch auto-deploys) uses real staff accounts and real data, including
children's contact details and allergies. All automated testing happens against
`wrangler pages dev` locally.
