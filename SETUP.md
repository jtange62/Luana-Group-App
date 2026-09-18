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
4. Add a tile for it in `public/tools/index.html` (the All-tools grid). `/` is
   the Today register, not the tool grid.
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

---

## Today-first (branch `today-first`)

`/` is the day's register. Marking attendance is the one thing staff do daily,
so it is the front door; the six tools moved to `/tools/`. The page also hands
back what the app already knows — allergies for the children actually in today,
each class's month theme, and what is on — so opening it is worth doing on a day
with nothing to type.

### Required once, against production D1

Migration 018 splits curriculum themes from library lessons (they shared the
`lessons` table with nothing to tell them apart) and adds the usage counter:

```powershell
npx wrangler d1 execute luana-board --remote --file migrations/018_today_first.sql
```

Both changes are additive, so the currently deployed app keeps working if the
migration runs before the branch is merged. A theme that was saved with only a
title stays classified as a library lesson — the migration comment has the
one-line UPDATE to move it back.

### Is anyone using it?

Every tool page counts one row per tool per day in `usage_daily`:

```
GET /api/usage?days=14   ->  { usage: [{ day, tool, hits }] }
```

Nothing in that table identifies a person. Before this there was no way to
answer the question without Cloudflare dashboard access.

### What was removed, and why

Four things were cut on the evidence of what production actually held. Every
table and every row was kept — only the interfaces went, so nothing is lost and
each cut is a revert away.

| Cut | What the data said |
|---|---|
| The calendar's attendance section (Day/Week/Overview + roster modal) | Today does this now, and it was the second of two places students could be edited. `calendar.js` went from 966 lines to 350. |
| Staff shifts | `staff` had 0 rows and always has, so the feature never once held data. All 7 events are `general`; nothing was orphaned. |
| The Lesson library | All 22 rows were curriculum themes. It was never a library — it was the overflow for themes needing a file, so Curriculum gained an attach-files control and the tool went. |
| Curriculum's Daily-plan layer | 6 schedule blocks and 1 day note, against the most complex machinery in the app (the time-block template and its 12-option `source` enum). Curriculum is now month themes and weeks. |

Routes deleted with them: `staff.js`, `schedule-block.js`, `schedule-blocks.js`,
`day-note.js`. `attendance.js`, `trials.js`, `lesson.js`, `lesson-file.js` and
`file/[id].js` all stay — Today and Curriculum still need them.

One deliberate gap: trial visits can still be *seen* on Today, but the only UI
that could *add* one lived in the calendar's day register. If you want to record
a new trial, that control needs re-adding somewhere.

### Daily summary

`GET /api/summary?date=&format=text` renders the day as a message. Staff can
read it in the app (**Copy today's summary**) with a normal session.

The **Daily summary** workflow pushes it to a chat channel at 17:00 JST on
weekdays. It is off until both secrets exist, and exits clean without them:

- `SUMMARY_TOKEN` — a strong random string, set as *both* a Cloudflare Pages
  secret and a GitHub Actions secret, exactly like `HEALTH_CHECK_TOKEN`.
- `SUMMARY_WEBHOOK_URL` — a GitHub Actions secret. The workflow POSTs
  `{"text": "..."}`, which Slack-compatible incoming webhooks accept as-is.


### School years (migration 023)

For an existing database, apply migrations/023_school_year.sql before releasing the school-year UI. Fresh installations already include it in schema.sql. The migration preserves IDs, attendance, files and content, assigning the existing undated roster and themes to 2026年度 (April 2026–March 2027).

Plans and student registrations are scoped by school_year (the April start year). Today derives the year from the selected date; previously recorded attendance still references its original student registration. The student source_student_id links copied registrations across years, while class details and profiles remain independent annual snapshots.

Plans and rosters can each be copied to an empty next year. Copies are transactional and protected against repeat requests. Plan attachments get independent R2 objects; reflections and attendance are not copied. Dated curriculum weeks/days shift to the same calendar dates in the next year (February 29 clamps to February 28), so staff should review weekdays. Summer roster copies clear selected week numbers; configure the new year's summer dates in Students → Summer School before enrolling students in weeks.

Calendar → Event → School break / closure records a dated closure for all classes or one class. Today excludes regular scheduled attendance for those dates but preserves explicit visits and recorded attendance. Japanese public holidays remain reference dates and do not automatically close classes.

Today → School-year summary reports recorded attendance and bookings within April–March; it is not an attendance-rate calculation and does not infer missing marks.
