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

## 024 — Ingesters diff before they write; SQLite runs WAL + synchronous=NORMAL (2026-09-07)

The first prod deploy on the e2-micro exposed the jobs ingester running two autocommit statements per listing, ~32k fsyncs an hour on a disk that does ~45 a second. Each run took 10–17 minutes, the box swapped, and cloudflared's QUIC connections timed out, which is what "host error" at the edge was. Now `upsertListings` loads the stored fingerprints, writes only new or changed rows in one transaction, and reports `changed` in the run counts. `openDb` sets `synchronous=NORMAL`, so fsyncs happen at checkpoints instead of every commit.
Why: the feed changes a few dozen rows an hour; rewriting 16k identical rows was pure I/O. NORMAL under WAL can lose the last commits on power loss but cannot corrupt, and every row here is re-fetchable from its source. The same rule applies to any future ingester: batch, diff, one transaction per run.

## 025 — `/api/health` is unauthenticated (2026-09-07)

Docker's HEALTHCHECK calls it from inside the container with no Access JWT; it returned 401 and the container sat at `unhealthy` forever. Externally the route is still behind Cloudflare Access on the hostname. It exposes only `ok`, `version`, `now`, `authDisabled`.

## 026 — One app-wide side pane instead of more widgets (2026-09-07)

Detail views (a whole course, a job with its tracker fields) open in a single right-hand sheet from anywhere; widgets stay summaries. Popovers remain for one-item detail.
Why: the first week of use showed the grid filling with one widget per thing to look at. A pane keeps the dashboard glanceable and gives each entity one place with everything, without a routing layer.

## 027 — The tracker lives on `job_state`, not a separate `applications` table (2026-09-07)

Stages extended to saved / applied / screen / interviewing / offer / rejected / ghosted / withdrawn, plus `applied_at`, `next_action`, `next_action_at`. Jobs added by hand are `jobs` rows with `source = manual`.
Why: a feed listing and a hand-added lead need the same fields and the same widget; a second table would have meant a union everywhere. `applications` stays in the schema unused rather than a migration that drops it for nothing.

## 028 — Canvas files open through `public_url`, never proxied (2026-09-07)

`/api/canvas/files/:id/open` fetches the file's `public_url` with the stored session and redirects the browser to it.
Why: every Canvas file URL ends at InstFS with `download=1`, so the browser saves instead of rendering. `public_url` is the same InstFS link without the flag, served inline by the CDN. The token is single-use, so the server must not follow it; redirecting keeps the box's egress at zero for files, which matters on a 1 GB/month allowance.

## 029 — Hand-entered course dates are items with `source = manual` (2026-09-08)

Exams, quizzes, finals, cancelled and virtual sessions are `items` rows (`kind = event`) rather than a new table.
Why: the calendar, popovers, class widgets, and the course pane already consume items; a separate table would have meant a second query and a merge in every one of them. `manual` has no `sources` row and no ingester, so the sources widget and settings never see it. Session tags carry `meetingKind`, which is how `nextMeeting()` knows to skip a cancelled lecture or label an online one.

## 030 — Grades are computed here from Canvas's groups, with a per-course override (2026-09-08)

The ingester stores assignment groups and Canvas's computed scores; `lib/grades.ts` recomputes the current grade the way Canvas does (category percentages after drop rules, weighted over categories with graded work when the course applies weights). `courses.grading` can replace the categories with hand-made ones keyed by group id or a title regex.
Why: Canvas's own number is one opaque float, and half the courses don't apply weights in Canvas even though the syllabus does. Recomputing gives per-category numbers and lets the syllabus weights be typed in; the regex path is what makes Gradescope-only courses work. Showing Canvas's number next to ours keeps any disagreement visible.

## 031 — Visual editors sit on top of the JSON, never replace it (2026-09-08)

The schedule is drawn on a week grid; dates are picked on a month calendar. Both write the same JSON/rows the API takes, and the raw JSON stays one click away in the course dialog.
Why: the grid can't express every edge (odd minutes, one-off rooms), and the JSON is what export/import and the seed use. Keeping both means the easy path is easy and nothing is unreachable.

## 032 — Session kinds are an open set (2026-09-08)

`CourseSchedule` is `Record<string, Meeting[]>`; the schema accepts any lowercase snake_case key. Lecture, discussion, lab, and office hours are the built-in chips; the editor adds a chip for any key the schedule already carries or the user types.
Why: the fixed three-key object silently stripped a typed-in `lab`, which read as a bug. Courses have seminars, studios, recitations; a closed enum would keep growing. Labels derive from the key, so nothing else needs a lookup table.

## 033 — The redesign keeps the grid and aliases the tokens (2026-09-09, `new-ui` branch)

The v2 design is implemented as a restyle over the same widget system: react-grid-layout, widget instances, saved layouts, the pane, all unchanged. Its palette became a small named token set that the shadcn variables alias to, so dialogs, popovers, inputs and settings pages follow without per-component edits. Widget-specific controls moved from widget bodies into the frame header through a portal.
Why: the mock still has "Edit layout", so it describes a default arrangement, not a fixed one; re-implementing the grid as fixed columns would have thrown away the per-breakpoint layouts. Aliasing tokens rather than rewriting components kept the change to the pieces the design actually shows. The branch stays separate until the look has been used for a while.

## 034 — Drop the `applications` table (2026-09-24)

Migration 0004 drops it. 027 kept it "rather than a migration that drops it for nothing"; two weeks on, the tracker on `job_state` has been used and nothing will move back, so the table was only a thing to explain.
Why: an unused table in the schema is a question every reader has to ask. A one-line migration answers it once.

## 035 — Deploys run in GitHub Actions on push to `main`; the image travels as a tarball over SSH (2026-09-24)

`.github/workflows/deploy.yml`: typecheck and tests gate the run, a GitHub-hosted runner builds the image natively for amd64, `docker save | gzip`, `scp` to the box, `docker load`, `compose up`, wait for `/api/health`. The runner has its own SSH key (public half in the instance's `ssh-keys` metadata, private half a repo secret). The outgoing image is kept as `collected:prev` for a one-command rollback.
Why: the box cannot build (024's neighbour: 1 GB RAM), so a build had to happen elsewhere, and the Mac's Docker Desktop hangs on pulls. A registry (GHCR) was the conventional alternative but a private package on a personal GitHub plan gets 500 MB storage and 1 GB/month transfer to the box; at ~110 MB per image that is about nine deploys a month. The tarball path has no quota and is the flow that was already proven by hand. One deploy at a time (`concurrency`), never cancelling a run mid-restart.
Rules out: GHCR or Docker Hub as the transport; a pull-based updater on the box (watchtower, a cron `compose pull`), which would have needed a registry credential on the box and given no feedback in the Actions run.

## 036 — API responses are gzipped and carry ETags (2026-09-24)

`hono/compress` and `hono/etag` on the `/api` router. Unchanged polls get an empty 304; changed ones travel gzipped (a 250 KB items response is 19 KB).
Why: the GCP bill for September was $0.24 and the free tier looked like a discount rather than free. It is free for the instance (a 100% credit on the e2-micro's core, RAM, 30 GB disk, and 1 GB egress); the charge was egress past that 1 GB: the box had sent 4.25 GB in 17 days, all of it raw JSON from widgets polling every minute through the tunnel (one `items` row is ~1 KB; a poll cycle is a few hundred KB). Neither Cloudflare nor the browser can shrink origin→edge bytes; only the origin can. Two built-in middlewares cost nothing and remove most of it. Trimming `raw` out of item payloads or lengthening the poll interval remain options if egress still shows.

## 037 — Course files sync to the laptop through an agent; names on the server, paths on the device; rules first, Laya second (2026-10-01)

See DESIGN.md "File sync to a laptop". A `collected-agent` CLI under launchd pulls a manifest, decides, downloads from the Canvas CDN into a staging cache, hard-links into target folders, writes a `_collected.md` manifest per folder, reports back.
Why: the server cannot write to a laptop and the box must not carry file bytes. Targets are names with descriptions on the server (the UI and rules and the model all work in names); paths are device-specific and a web page cannot pick a folder anyway, so they live in the agent's config. Rules on Canvas folder path, module name, and filename cover most courses for free and are inspectable; the model handles flat-dump courses and the long tail. Laya runs locally because the laptop is already running the agent, the choice set is tiny (where Laya is strongest), it costs nothing per call, and it can see file content later; it cannot run on the box (1.7 GB of weights, 2 GB RAM). The staging cache plus hard links makes re-sorting a relink, makes "skip" reversible, and keeps a pristine copy so a user's annotated PDF is never overwritten. The model's threshold is applied on the server at read time so changing it re-sorts without re-running.
Rules out: browser-side downloading (can't write unattended; the CDN would need CORS); server-side classification with a hosted model (would still need the agent for placement, and puts a key on the box for no gain); a separate `applications`-style table per decision kind (one `file_sync_state` row per file holds the manual, model, and placement facts).

## 038 — Scripts reach the API through a Cloudflare Access service token (2026-10-01)

Probing prod showed `POST /api/sources/canvas/cookie` answered with Access's login redirect: the cookie helper's `x-collected-key` never got past the edge, and the SETUP note saying otherwise was wrong. Access service tokens are the mechanism for non-browser clients: Cloudflare exchanges `CF-Access-Client-Id/Secret` for the same JWT the app already verifies, with identity in `common_name` instead of `email`. The verifier now accepts that. `LOCAL_HELPER_KEY` stays as a local/dev credential and is accepted by the API middleware generally rather than on one route.
Why: one verification path for browsers and scripts, no bypass rules at the edge, revocable from the Cloudflare dashboard.

## 039 — The file-sync classifier is hosted Jev, not local Laya (2026-10-01)

037 chose Laya running inside the agent. Before the first real run it was swapped for TypeSafe's hosted Jev over `POST /v1/systemone`, with the base URL configurable so a local `laya-serve` still works.
Why: Laya's Node package pulls 1.7 GB of fp32 weights and wants ~2 GB of RAM while classifying, on a laptop that is short on RAM, for a job that is a few hundred tokens per file a few times a week. Jev's price for that is effectively zero, there is nothing to download or keep warm, and the request and response shapes are identical, so the agent's code did not change beyond the transport. The `@receptron/laya` dependency (and its native ONNX runtime) is gone from the workspace.
Rules out: bundling a model with the agent. A generative LLM for this was never considered: a typed choice with probabilities is the right tool, and both System 1 models return exactly that.

## 040 — File sync policy and mechanics, agreed with the consumer of the files (2026-10-01)

The first real sync into the Obsidian class-notes vault was reviewed by the session that maintains that vault's ingest pipeline, and the sync was reshaped around what it found. Policy: skip archives, source code and starter trees, widgets and media, datasets and binaries, oversized text and readings; keep PDFs, lecture notebooks, and Markdown handouts (renamed from their first heading, with frontmatter). Mechanics: Canvas display names instead of upload names; Canvas subfolders mirrored under the target, with a per-rule `flatten` for folders that are the category itself; content-hash adoption of files already present under any name; rename and move of untouched copies when the layout changes; atomic writes with Canvas's mtime and no rewrites of unchanged files; skipped files listed with ids and fetchable with `pull`; per-course `assignments.md`, `announcements.md`, `syllabus.md` beside the index.
Why: the consumer keys extraction on path and mtime, so a rewrite or an encoded name costs it re-extraction and lost vision transcriptions; duplicates double its index; and its main question type is deadlines, which PDFs do not carry and collected already has. Display names also removed every `(2)`: the collisions came from upload names (`Chapter4+2.pdf` twice), never from what Canvas shows. Layout is an explicit flag on the rule rather than inferred from which folder is busiest, because an inference flips when a second project folder appears and files then move for no visible reason. Skipping is expressed as rules, not left to the model, so it is inspectable and free.
Left open: "skip a blank-notes file when a filled counterpart exists" has no reliable key (the pair are `Chapter4.pdf` and `Lecture9_Sept29.pdf`), so blank notes stay in their own subfolder; a read-only Canvas browsing command for local tools would need a Canvas GET proxy on the API and waits for a decision.
