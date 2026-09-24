# Luana Group App — setup & deploy guide

A hub of staff tools for Luana English School. One shared password gets your team
into everything. The first tool is the **idea board**; the hub is built so more
tools (calendar, lesson library) drop in as new folders later.

Hosted entirely on Cloudflare Pages + a D1 database — the same Cloudflare account
and GitHub-push workflow you use for the school site. No server to maintain.

---

## How it's structured

```
public/
  index.html         ← hub home: login + tool tiles
  shared-auth.js     ← single login shared by every tool
  shared.css         ← palette + base styles (used hub-wide)
  tools/
    ideas/           ← the idea board (tool #1)
      index.html
      ideas.js
      ideas.css
functions/
  api/               ← backend, shared by all tools
    login.js  posts.js  post.js  comment.js  _helpers.js
schema.sql           ← database tables
wrangler.toml        ← Cloudflare config
```

**The single-login design:** a visitor logs in once at the hub. The token is saved
on their device, and every tool reads it via `shared-auth.js`. Open a tool while
logged out and it bounces you back to the hub to sign in. Change the password in
one place and it covers everything.

---

## Before you start

Install Cloudflare's CLI once:
```
npm install -g wrangler
wrangler login
```

---

## Step 1 — Create the database

```
wrangler d1 create luana-board
```
Copy the `database_id` it prints into `wrangler.toml` (replace
`PASTE_YOUR_DATABASE_ID_HERE`). Then create the tables:
```
wrangler d1 execute luana-board --remote --file=schema.sql
```

---

## Step 2 — Push to your GitHub repo

Your repo is **Luana Group App**. On its GitHub page, click the green **Code**
button and copy the exact HTTPS URL (GitHub hyphenates the spaces). Then:
```
git init
git add .
git commit -m "Hub + idea board"
git branch -M main
git remote add origin <PASTE THE URL FROM GITHUB>
git push -u origin main
```

---

## Step 3 — Connect Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick **Luana Group App**.
2. Build settings:
   - **Framework preset:** None
   - **Build command:** *(blank)*
   - **Build output directory:** `public`
3. **Save and Deploy.**

---

## Step 4 — Secrets & database binding

Pages project → **Settings**:

**Variables and Secrets:**
| Name | Value |
|------|-------|
| `STAFF_PASSWORD` | the password you give staff |
| `SESSION_SECRET` | any long random string (40+ chars) |

**Functions → D1 database bindings:**
| Variable name | D1 database |
|---------------|-------------|
| `DB` | `luana-board` |

Then **re-deploy** (Deployments → ⋯ → Retry deployment).

---

## Step 5 — Live

Your hub is at `https://luana-group-app.pages.dev`. Share that link + the password
in your LINE group once.

**Optional custom domain:** Pages → **Custom domains** → add e.g.
`app.luanaenglishschool.jp`. The idea board then lives at
`app.luanaenglishschool.jp/tools/ideas/`, reached by tapping its tile on the home page.

---

## Adding the next tool later (calendar, lesson library)

The home page already shows greyed-out "soon" tiles for both. When you're ready
to build one:

1. Make a new folder: `public/tools/calendar/` with its own `index.html` +
   JS/CSS, mirroring how `tools/ideas/` is built.
2. At the top of its JS, call `LuanaAuth.requireLogin()` and use `LuanaAuth.api(...)`
   for any backend calls — login is already handled for you.
3. Add any new backend routes under `functions/api/`.
4. In `public/index.html`, turn that tool's tile from a `<div class="tool-tile is-soon">`
   into an `<a class="tool-tile" href="/tools/calendar/">`.
5. Commit + push — Cloudflare redeploys automatically.

Each new tool reuses the same login, palette, and database. Just ask me when you
want to build one and I'll generate the folder.

---

## Common tweaks

- **Categories** (idea board): edit `CATS` in `public/tools/ideas/ideas.js` and
  `CATEGORIES` in `functions/api/post.js` — keep the `id` values matching.
- **Password:** update `STAFF_PASSWORD` secret + redeploy. To force everyone to
  re-login immediately, also change `SESSION_SECRET`.
- **Colors/branding:** the `:root` block at the top of `public/shared.css`.

---

## Honest limits (unchanged from before)

- **Shared password, not real accounts** — anyone with the link + password posts
  under whatever name they type. Right trade-off for a small trusted staff.
- **No edit/delete in the UI yet** — removing a post means a direct DB command, or
  ask me to add a "delete your own post" button.
- **Link previews depend on the target site** — most unfurl; some show a plain link.
- **Cost:** comfortably within Cloudflare's free tier.
