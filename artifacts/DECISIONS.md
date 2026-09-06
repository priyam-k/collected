# Decisions

Append-only log. Newest at the bottom. Each entry: what, why, what it rules out.

## 001 — One process + SQLite, not Supabase or Workers (2026-09-06)

Single Node process running API, scheduler, and static serving, with SQLite on a volume.
Why: one user; the hard part is scrapers on a timer, which want a normal runtime you can debug locally. Supabase would push scrapers into Deno edge functions with CPU limits and pauses idle free-tier projects. Workers/D1 has runtime restrictions that bite scrapers. Postgres buys nothing for one user.
Rules out: Supabase, Cloudflare Workers/D1, any split frontend/backend hosting.

## 002 — Cloudflare Tunnel + Access for exposure and login (2026-09-06)

No open ports on the host. Access enforces an email allowlist at the edge (Google IdP and/or one-time PIN). The app only verifies the Access JWT.
Why: zero auth code to write or get wrong; unauthenticated traffic never reaches the app; domain is already on Cloudflare; free tier.
Rules out: in-app login pages, in-app Google sign-in for site access. (Calendar OAuth is separate and still in-app.)

## 003 — TypeScript everywhere: Vite + React SPA, Hono server (2026-09-06)

Why: app, not content site, so Astro is the wrong shape. React has the deepest ecosystem for a draggable grid and data fetching and is what LLMs generate most reliably. One language lets types flow from DB to widgets. Hono over Next/SvelteKit because a long-running scheduler wants a plain server process, not request-scoped route handlers.
Rules out: Astro, Next.js, SvelteKit, Python backend.

## 004 — Widget grid: react-grid-layout + container queries + size tiers (2026-09-06)

Explicit edit mode (drag/resize only when toggled on). Layout persisted per breakpoint. Each widget declares presets and min/max, and reflows via `@container` CSS plus a `useWidgetSize()` tier hook.
Why: phone-widget mental model; static-by-default avoids accidental drags on touch; container queries make reflow depend on the widget's box, not the viewport.
Fallback: gridstack.js if react-grid-layout misbehaves on touch.

## 005 — Widgets are a data-driven registry (2026-09-06)

One definition object per widget: type, sources required, presets, config schema, component. Multi-instance allowed (class widget). Missing sources render a placeholder.
Why: opt-in pieces; adding a widget is adding a file; settings forms come from the schema.

## 006 — Courses live in the DB, edited in settings, with JSON export/import (2026-09-06)

Why: a config file as source of truth would need a deploy to add a hotlink. Export/import keeps the "edit a file" workflow available.

## 007 — Canvas via session cookie, iCal as fallback (2026-09-06)

Cookie jar persisted after every run so the one-day sliding session never lapses. Fallback to the iCal feed on `needs_auth`, so Canvas goes stale-but-present, not empty.
Why: admin disabled student PATs. Verified in Canvas source: `_normandy_session` `expire_after` defaults to 1 day and slides on every request. iCal has no submission state, which is the trust problem this app exists to fix.

## 008 — Gradescope: own scraper with cheerio, native password (2026-09-06)

Why: pages needed are server-rendered Rails; community libraries are all requests + BeautifulSoup and unmaintained. Writing ~150 lines we own beats a dependency. Native password skips CAS/Duo.
Fallback: Playwright persistent profile if a needed page turns out JS-rendered.

## 009 — Google Calendar via OAuth from day one, read+write, consent screen published (2026-09-06)

Why: writes are wanted; building iCal now and OAuth later is building it twice. Consent screen in Testing status expires refresh tokens after 7 days, so publish it (unverified warning is fine for a personal app).

## 010 — Todoist push sync is one-way and closes-only (2026-09-06)

Store → Todoist. Done only moves toward closed; never reopen; hand-closed tasks stay closed. Marker line in task description makes the map rebuildable.
Why: accidental Todoist edits must not touch Canvas/Gradescope; duplicate tasks are the classic failure and the marker prevents them.

## 011 — Todo widget reads the unified store, not Todoist (2026-09-06)

Why: homework section must work with push sync off; Todoist is the phone/watch surface, not the source of truth for assignments.

## 012 — Dedup is per course via `submits_via` (2026-09-06)

`gradescope` / `canvas` / `both`, default `both` with fuzzy linking. Manual link/unlink in settings.
Why: which system is authoritative differs per class; a global heuristic gets it wrong somewhere every semester.

## 013 — Jobs: Simplify listings.json, deterministic filter in v1, LLM scoring in v2 (2026-09-06)

Why: the JSON is the real source behind the README; deterministic filter is free and debuggable; Haiku scoring is cheap but should come after the feed is proven useful. SWE List is email-only as far as known; Pinloop evaluated later.

## 014 — VPS over Raspberry Pi (2026-09-06)

Hetzner Cloud, smallest x86 Ubuntu instance, US region. One box hosts multiple projects behind one tunnel.
Why: a VPS is the same box with power, network, and hardware handled for you. A student moves yearly and sits on campus wifi; a home box adds outages to debug. Tunnel makes moving to a home box later a config change.

## 015 — Commit conventions (2026-09-06)

Plain commit messages. No Co-Authored-By or session trailers. Commit at meaningful steps (a working milestone, a completed ingester, a schema change), not per file.

## 016 — libsql instead of better-sqlite3; tsup bundle for the server (2026-09-06)

`@libsql/client` over a `file:` URL with Drizzle's libsql driver. Server bundled with tsup (shared package inlined, node_modules external), deployed with `pnpm deploy --prod`.
Why: libsql ships N-API prebuilds that work on any Node version (the Mac runs Node 25; Docker runs Node 24); better-sqlite3 needs per-version binaries. tsup avoids emitting TypeScript from a workspace package at runtime.

## 017 — Jobs ingester built first, as the pipeline proof (2026-09-06)

It needs no credentials, so it exercised runner → status → sources widget on day one. The `category` and `terms` fields in Simplify's JSON became filter dimensions after the first real pull showed the repo carries every past season.

## 018 — Canvas cookie helper is Python (2026-09-06)

`local/canvas_cookie.py` uses browser-cookie3 to read Chrome's Keychain-encrypted cookie store. Hand-rolling that decryption in TypeScript is the error-prone path; the helper is a 60-line script that only runs on the Mac.

## 019 — TA-course rows are informational (2026-09-06)

Assignments from courses where the role is TA (Canvas TaEnrollment / Gradescope instructor list) are stored with `raw.ta=true`, never `missing`, excluded from todo/calendar and from the Todoist push, shown in the class widget with the grading queue.
Why: Canvas returns an empty submission for a TA, which would otherwise read as "you have homework due".

## 020 — Linked pairs collapse to one row (2026-09-06)

When a Canvas and a Gradescope assignment are linked, the items API returns only the preferred side (`submits_via=gradescope` → Gradescope row, otherwise Canvas row) with `linkedIds` pointing at the other; done is true if either side is done. `submits_via=canvas` never links and marks Gradescope rows informational.
Why: widgets should never show the same homework twice; the preferred side is the one whose status is trustworthy for that course.

## 021 — Gradescope instructor pages are read from embedded React props (2026-09-06)

The instructor assignments table is React-rendered, but its data is embedded server-side as JSON in `data-react-props` on the mount point, so plain HTTP still works. Student pages remain server-rendered tables.

## 022 — Encryption key lives in the data directory (2026-09-06)

`SECRET_KEY` in `.env` is optional; when empty the server reads or creates `DATA_DIR/.secret_key` (mode 0600). Credentials that fail to decrypt flip their source to `needs_auth` with a message naming the cause.
Why: a recreated `.env` on day one silently lost the key and with it every stored credential. The key belongs next to the database it protects, inside the same Docker volume, and a lost key should be a visible state rather than a quiet "disconnected".

## 023 — Per-source data viewer in settings (2026-09-06)

Every source card has an expandable "Data pulled" panel: last run counts and duration, rows per course with the matched external id, recent rows. Backed by `GET /api/sources/:id/summary`; the runner stores each run's counts in `sources.meta.lastRun`.
Why: "it says connected" is not evidence. The first real Gradescope sync looked like a no-op until the rows were listed.
