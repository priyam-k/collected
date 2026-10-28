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
Added the same day, after the consumer ingested the result and found the syllabus PDFs of three courses and an open homework's spec missing: the ingester follows file links in page bodies and module items to files the listing hides, and a `linked` rule condition routes them. This is ingestion completeness, not new API surface: the same session, read-only, one lookup per unlisted file.
Left open: "skip a blank-notes file when a filled counterpart exists" has no reliable key (the pair are `Chapter4.pdf` and `Lecture9_Sept29.pdf`), so blank notes stay in their own subfolder; a read-only Canvas browsing command for local tools would need a Canvas GET proxy on the API and waits for a decision.

## 041 — Partial updates go through `parsePatch`; never write back `schema.partial().parse()` (2026-10-01)

`PUT /api/courses/:id`, `PUT /api/widgets/:id` and `PUT /api/todoist/config` validated partial bodies with `schema.partial()` and wrote the result. zod 4 applies `.default()` even under `.partial()`, so `{ fileSync: … }` parsed to `{ fileSync: …, role: "student", submitsVia: "both", links: [], schedule: {}, archived: false }` and every field the client omitted was reset. A script that set only `fileSync` on five courses emptied their class schedules and hotlinks. `parsePatch` in `api/util.ts` validates the partial body and returns only the keys that were actually sent; `api/patch.test.ts` pins the behaviour for all three routes.
Why: a partial update must mean "change these fields". The bug had been reachable from the UI since the grades editor (which sends only `grading`); the script just hit it everywhere at once.
What it cost: four schedules and one hotlink were restored by reading the old row bytes that SQLite had not yet overwritten in the database file; one course's schedule was not recoverable. There was no backup to restore from. The nightly backup listed under M9 since the first deploy would have made this a non-event.
Rules out: spreading or `.set()`-ing the output of a partial zod parse anywhere. Bulk writes to production from a script snapshot the affected rows first and diff them after.

## 042 — A `collected` CLI over the existing API, with a read-only Canvas proxy (2026-10-01)

`collected <command>` in the `agent` workspace reads and edits what the dashboard does (courses, assignments, agenda, grades, dates, hotlinks, schedule, notes, tasks, tracker) and browses Canvas (modules, pages, full assignment text and rubrics) through one new route, `GET /api/canvas/raw`.
Why: agents working elsewhere on the laptop (the class-notes vault's) need assignment status, deadlines and course material without a browser, and need to write small facts back (an exam date read from a syllabus, a hotlink). Everything except Canvas browsing was already an API route, so the CLI is a thin client and nothing it does is unavailable to the web UI. Canvas browsing goes through the server so the Canvas session stays where it already is; the route is GET-only by construction and limited to Canvas API paths.
Rules out: a Canvas token or cookie on the laptop; any command that writes to Canvas or Gradescope (CLAUDE.md's Todoist rule extends naturally: the only external writes are a Todoist task and a Todoist close, both already in the API).


## 043 — Security review fixes: fail-closed ingest, least privilege per credential, outbound URL policy (2026-10-23)

A full review (`SECURITY-REVIEW.md`) found no outsider-exploitable hole but several data-loss paths and trust-boundary gaps. The fixes set rules the code now follows:

- **An empty upstream answer is not a deletion.** `upsertItems` skips the soft-delete pass when it saw zero rows unless the caller says empty is real; the Canvas ingester fetches each course's assignments with `getAll` (not the swallowing `tryGetAll`) and leaves a failed course out of the delete scope; the runner races the run against its timeout so a timed-out run is recorded as `error` and the after-hooks (dedup, push) do not act on it. The Todoist push refuses `delete` ops while the removed item's source is not `connected`, when more than a quarter of mapped items (min 5) vanished at once, or when all of them did. Deleting the task for an assignment removed at the source stays (DESIGN "Todoist push sync"); CLAUDE.md now says so.
- **Every outbound fetch has a deadline and a byte budget** (`server/src/lib/http.ts`: `withTimeout`, `readText`), and every user-settable fetch target (Canvas base URL, iCal feed, job feeds, including feeds set through source meta) passes `outboundUrlSchema`: https to a public host, http only to loopback. Pagination and redirect targets are checked against the configured origin; the Gradescope login POST is never followed off-host with the form body.
- **Credentials carry their scope.** `identityAllows` in `api/index.ts`: the helper key opens one route; a service token (the laptop CLI) can read, make the CLI's small edits and run the file sync, but not import/export, credentials, settings, layout, OAuth, or delete anything. Writes by non-person identities are logged. The helper key must be 32+ characters and is compared as a digest.
- **State changes need a same-site browser or no browser.** Mutating requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are refused, and JSON routes require `content-type: application/json`, so the Access cookie's SameSite setting is no longer the only thing between a form on another site and `/api/import`.
- **The laptop never trusts a target or a redirect.** The agent checks every manifest target and classifier answer against the course's allowed targets and keeps every write, move and delete under the course root (`assertInside`); downloads follow only an https redirect to a public host with a byte budget; plain http is refused for the server and the model unless loopback; secrets are read from a prompt or stdin rather than argv.
- **Headers, limits, snapshots.** `secureHeaders` with a CSP (no inline scripts: the theme bootstrap became a module), `private, no-cache` on `/api`, a 1 MB body limit (16 MB import, 4 MB file-sync report), bounded free-text fields, a pre-migration `VACUUM INTO` snapshot in `data/backups/`, a backup script and a deploy that rolls back on a failed health check. `AUTH_DISABLED=true` in production refuses to boot without `AUTH_DISABLED_ACKNOWLEDGED=true`.

Why: open-sourcing and hosting both move the server, the laptop and the user into different trust domains; every rule above is one that was implicit while all three were the same person. The 2026-10-01 incident (DECISIONS 041) was a reminder that the costly failures here are the quiet ones.
Rules out: `no-store` on API responses (would lose the 304s of DECISIONS 036); the helper key as a general credential; DNS-resolution checks for SSRF (literal ranges and names only; a hosted deployment needs a resolver-level check or an allow-list of LMS hosts, see the review's Tier 3).

## 044 — In-app sign-in with Google, sessions, and CLI tokens; Cloudflare Access becomes optional (2026-10-26)

Until now the only login was Cloudflare Access in front of the tunnel, and the only non-browser credential was an Access service token. That made self-hosting mean "set up Cloudflare Zero Trust" and made hosting other people impossible. The app now signs people in itself (Google identity only, session cookie backed by a `sessions` table), mints per-machine API tokens for the CLI (`collected login`, hashed at rest, shown once, scoped by `identityAllows` exactly like a service token), and treats Access as an optional extra wall whose JWT is still honoured when configured.
Why: both the open-source and the hosted paths need an identity the app owns. Google for identity costs nothing in verification (non-sensitive scopes) and the project already had a Google client for Calendar. Sessions in the database rather than signed cookies so a session can be revoked and listed. Tokens rather than long-lived sessions for the CLI so a lost laptop is one revoke in Settings → Account.
Rules out: email/password (a second credential to store, and nothing here is worth a password reset flow); magic links (needs outbound email); reusing the Calendar consent for login (users who never connect a calendar should never see the sensitive-scope screen). Single-user stays the default: the first sign-in claims the instance; multi-user is `ALLOWED_EMAILS` today and the tenant work later.

## 045 — Onboarding from Canvas enrollments; Google Calendar without OAuth; the CLI reads the browser cookie (2026-10-26)

Three pieces of the open-source path landed together. `GET /api/onboarding/canvas` lists active enrollments with a suggested term slug, code and section, and `POST` turns a selection into course rows (colour assigned, class widget created, a Canvas sync kicked off); Settings → Courses gets "Import from Canvas" and an empty dashboard shows the two setup steps. `seed-config.json` stays for people who prefer a file, as an example. `gcal_ical` ingests a Google Calendar's secret iCal address read-only (recurrences expanded over -14/+60 days, capped), so a self-hoster can see their calendar without a Google Cloud project; OAuth remains the path for quick-add writes. `collected connect canvas` reads the Canvas session cookie from Chrome, Brave, Edge, Arc, Chromium or Firefox in Node (Keychain-decrypted, `node:sqlite`, no dependencies) and posts it, retiring `local/canvas_cookie.py` and the Python toolchain it needed.
Why: a stranger's first ten minutes decide whether a self-hosted tool gets used. Typing courses into a JSON file, creating a Google Cloud project before seeing a calendar, and installing a Python venv to get Canvas working were each a place to give up.
Rules out: scraping the Canvas login page for a session (fragile, and against the spirit of the cookie being the user's own); a browser extension for the cookie (another thing to install and review).

## 046 — The UI moves to Caustic: warm grounds, one accent, instruments, glass only where things float (2026-10-28)

The "Collected Dashboard v2" look (cool grey surfaces, five accents tinting every widget, a grey header bar per card, glows) is replaced by the Caustic design system, adapted for a dense dashboard. Eggshell and charcoal grounds; one accent chosen per browser from four; status colours only as words that need them (overdue, needs auth, offer). Cards keep their title inside the card. Progress, grades and the clock become tick instruments. Liquid glass is used for the floating toolbar and the public header and nowhere else; menus are frosted; segmented controls, the settings nav and the pane tabs get a springing selection thumb. Mona Sans and Geist Mono are self-hosted because the CSP allows fonts from 'self' only. The old token names stay as aliases so call sites did not have to change at once.
Why: the board is looked at many times a day; five accents plus per-widget tints made every card compete, and status colours (overdue in coral) were hard to tell from decoration. With one accent, colour on screen means something.
Rules out: per-widget accent colours (the registry `accent` field now only matters for `course`); Mona Sans's tabular figures (its tabular zero is slashed and reads as code, so the sans uses proportional figures).

## 047 — Self-host update check: GitHub compare, an allow-list of paths, the operator runs the commands (2026-10-28)

The server knows which commit it is running (`COLLECTED_COMMIT` baked by the Dockerfile, else `server/build-info.json`, else `git rev-parse` in dev, else "dev") and every six hours asks GitHub's unauthenticated compare endpoint how far `main` is ahead of it. `matters` is true only when one of the new commits touched a path that changes the running app (`server/`, `web/`, `shared/`, `agent/`, the Dockerfile, `docker-compose.yml`, the package and lock files, `CHANGELOG.md`); docs, workflows, `artifacts/` and `e2e/` do not light the banner. `CHANGELOG.md` has a strict heading format (`## x.y.z — date · recommended|optional`) that the server parses to show what is new. The last result is persisted in `settings` under `system.update` so a restart does not blank the banner, and a failed check keeps the last good answer with an `error` next to it. The image is published to GHCR by `image.yml`; `docker-compose.yml` runs that image and `docker-compose.build.yml` is the override for building locally. Prod (`deploy.yml` + `scripts/deploy.sh`) still ships a tarball over SSH and retags it under the GHCR name.
Why: a self-hoster who cloned once has no way to notice a fix. The compare endpoint answers in one request with the count, the head sha and the changed files, which is enough to say "there is something" and "it is worth your time" without a release process. GitHub's `files[]` is what makes the docs-only filter possible at all.
Rules out: the container updating itself (it runs read-only, without the Docker socket, as `node`; the three commands are the operator's, printed in the banner); a GitHub token (60 unauthenticated requests an hour per IP is 15× what one instance uses); comparing against releases rather than `main` (there is one `main` and it deploys the maintainer's box, so `main` is the release); a `pull_request` trigger on `image.yml` (no push from a fork's PR, ever). `UPDATE_CHECK_DISABLED=true` turns the whole thing off, request included.

## 048 — Todoist connects with OAuth when the operator registered an app; the pasted token stays the fallback (2026-10-28)

The Todoist card offers **Connect Todoist** when `TODOIST_CLIENT_ID` / `TODOIST_CLIENT_SECRET` are set (`GET /api/todoist/connect` → `todoist.com/oauth/authorize` → `GET /api/todoist/callback`, scope `data:read_write,data:delete`), and the pasted API token form otherwise or folded under "or paste an API token". The callback stores the token in the same encrypted `{ token }` config slot the pasted token uses, so the ingester, the push sync and the CLI see no difference; `meta.connectedVia` (`oauth` | `token`) is the only record of how it arrived, and `POST /api/todoist/disconnect` revokes an OAuth token at Todoist best-effort before clearing it. The flow copies the Google Calendar connect: a random state bound to the signed-in identity with a ten-minute TTL, fixed reason codes on the redirect (`denied|expired|exchange|config`), the exchange through `withTimeout`/`readText` with no library. The sources payload gains `oauthAvailable` for todoist so the UI decides from the server's environment. The three routes join the deny list for service tokens and the helper key, like `/api/google`.
Why: finding the API token under Settings → Integrations → Developer is the step self-hosters stumbled on, and Todoist's app console is free with no organisation or review. Keeping the pasted token means a single-user install never has to register an app, and a deployment whose app console entry is lost still works.
Rules out: a separate storage slot or token type for OAuth tokens (would fork every reader for no gain; Todoist tokens do not expire, so there is nothing to refresh); dropping `data:delete` from the scope (the push sync's delete of a task it created is a documented behaviour, DECISIONS 043, and would silently fail without it); treating the callback as an open path (unlike Google sign-in, the browser already has a session when Todoist sends it back, so it stays behind the login wall and the state is checked against that identity).

## 049 — Google Tasks as a second to-do source: incremental consent, no push, a default-app setting (2026-10-28)

Google Tasks is a source (`gtasks`) next to Todoist. It reads every task list (completed and hidden tasks included, completed ones aging out after 30 days like Todoist's, 500 per list), maps tasks to `kind=task` items with the list name as the project and as a label, and nests subtasks. The to-do widget shows both sources in one list with the source tag every row already carries, and closes a task in the app it came from (`POST /api/gtasks/tasks/:id/close`, `:id` = `<listId>:<taskId>`). `POST /api/gtasks/tasks/quick` adds `{content, due?}` to the default list. A setting `todo.defaultApp` (`todoist` | `gtasks`) picks where the add-task box sends; unset, or set to an app that is not connected, it falls back to whichever is connected, Todoist first (`resolveTodoApp`), so nothing is seeded. Each list is its own delete scope: a list whose fetch failed, was truncated at the cap, or came back empty deletes nothing, and every list failing is an error for the run.
Why incremental consent: the Calendar connect is already a sensitive-scope screen, and people who only want Tasks (or only Calendar) should be asked for exactly that. `/api/google/start?source=gtasks` reuses the same OAuth client and callback URI and requests only `auth/tasks` with `include_granted_scopes=true`; the refresh token is stored under `gtasks`, so disconnecting one never breaks the other and the Calendar consent is unchanged. The callback refuses a grant where the user unticked the tasks scope.
Why no push: the Todoist push exists because Todoist is where the assignments get scheduled; doing it twice means two mirrors of every assignment and two sets of fuses (DECISIONS 043) to keep correct. Google Tasks is read plus add and close; the push stays Todoist-only.
Rules out: a combined Calendar+Tasks consent; writing to Canvas or Gradescope from a Google task (the CLAUDE.md Todoist rule applies to every to-do app); reopening tasks; a natural-language parser for Google Tasks quick-add (the API has none; the due date is a plain day).

