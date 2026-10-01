# collected — backend overview

_The landscape, readable in ten minutes. For every route, column, and raw key, see REFERENCE.md. For why, see DECISIONS.md._

## The mental model

The app **copies, it never owns.** Canvas is the truth about assignments, Gradescope about submissions, Google about events, Todoist about tasks, a GitHub JSON file about internships. The server's job is to keep a local copy of all of that in one SQLite file, layer *your* decisions on top (done-here-only, hidden, "these two rows are the same homework"), and answer the browser's questions fast from that copy. It almost never talks to a source while you're looking at the page; syncing happens on timers in the background.

Everything else follows from that.

## What's actually running

One Node process. Inside it, three things share one SQLite file:

- **Hono HTTP server** on port 3000: the `/api/*` JSON routes plus the built React app as static files.
- **Scheduler** (croner): one cron entry per ingester, each on its own interval (Canvas 15 min, Gradescope 30, Google/Todoist 5, iCal/jobs 60), staggered so they don't fire together. Five seconds after boot it runs everything once so a fresh deploy isn't empty.
- **SQLite** via `@libsql/client` + Drizzle, WAL mode, `synchronous=NORMAL`. No queue, no worker, no cache layer.

One thing runs *off* the box: `collected-agent` (the `agent` workspace) on the laptop under launchd. It pulls a manifest of course files and decisions, downloads from the Canvas CDN into local folders, writes a per-course index plus assignments/announcements/syllabus files from the API, and reports back. The server never touches file bytes.

Why one process (DECISIONS 001, 003): the hard part of this app is scrapers on a timer, which want a boring long-lived runtime you can debug locally with `pnpm sync canvas`. Serverless and edge runtimes fight that. Postgres buys nothing for one user. Hono was picked over Next/SvelteKit because a scheduler wants a plain server process, not request-scoped handlers.

**Boot** (`server/src/bootstrap.ts`, shared by server and CLI): load `.env` → open DB → run pending Drizzle migrations → build the `AppContext` `{env, db, log, crypto, version}` → seed. Seed inserts the six `sources` rows every boot and, only if `courses` is empty, loads `artifacts/seed-config.json`. Every route and ingester receives that one `ctx` object; there is no DI framework, just a struct passed down.

## The data model, by purpose

Twelve tables, in four groups. The boundary between groups 1 and 2 is the most important design idea in the backend.

**1. Copies of what sources said**
- `items` — the unified feed. Every assignment, event, task, announcement from every source, normalized to the same columns (`title, due_at, starts_at, status, course_id, …`) plus a `raw` JSON bag for per-source details. Id is always `source:externalId` (e.g. `canvas:assignment:7775093`), which is what makes re-syncs idempotent and lets every other table point at items stably.
- `course_content` — per-course material that isn't an item: syllabus, module items, files, Canvas assignment groups (for grades), TA grading queue. Replaced wholesale per course on each sync.
- `jobs` — the internship feed (~16k rows across seasons), plus hand-added rows with `source=manual`.

**2. Your decisions, kept separate**
- `overrides` — per item: `hidden`, `done`, `snoozed_until`, `note`. "Done here only" never goes to the source.
- `item_links` — pairs of items that are the same real-world homework (Canvas + Gradescope). `method=auto` rows are recomputed every sync; `manual` rows are never touched.
- `job_state` — your relationship with a job: stage, notes, applied date, next action. This *is* the applications tracker (DECISIONS 027).
- `courses` — your classes, with role, color, links, schedule, `submits_via`, a grading override, and a `file_sync` config (target names, rules, fallback). Seeded once, then edited in Settings.
- `file_sync_state` — per Canvas file: your manual target, the model's answer, where the agent placed it. Rule decisions are derived, not stored.

Because group 2 is separate from group 1, **a re-sync can never wipe a decision**, and any of the three (source data, overrides, links) can be reset without touching the others. That's why the store looks slightly redundant.

**3. Source bookkeeping**
- `sources` — one row per integration: `status` (disconnected / connected / needs_auth / error), last run/success/error, `config_enc` (encrypted credentials), and `meta` (non-secret state like Google sync tokens, Todoist project list, last-run counts).
- `todoist_map` — which Todoist task was created for which assignment, plus the hash of what was last pushed.

**4. The dashboard's own state**
- `widget_instances`, `layouts` (per breakpoint), `settings` (key → JSON).

Time is always ISO UTC text; day-only values (applied date, exam date) are `YYYY-MM-DD`. Booleans are 0/1 integers. Several columns are JSON-as-text, which is how the schema stays small: new per-source detail goes in `raw`, not a migration.

## Ingesters: the write path

Every source has a folder under `server/src/ingest/<source>/` with roughly the same three files: a **client** (HTTP + auth + pagination for that source), a **map** (source JSON/HTML → `items` rows, pure functions, fixture-tested), and an **ingest** (orchestrates the calls, calls the two shared writers). Each exports an `Ingester` object: `{ id, intervalMinutes, timeoutMs, run(ctx, signal) }`. `ingest/registry.ts` lists them; the scheduler and CLI both iterate that list.

The **runner** (`ingest/runner.ts`) is what makes them uniform. It wraps every run with: a per-source mutex (skip if already running), the `enabled` check, a timeout that aborts the fetches, and status writing. It classifies failures by error type: `NotConfiguredError` → `disconnected`, quietly; `NeedsAuthError` or an undecryptable config → `needs_auth` with a message; anything else → `error`. The runner never throws. That's why the Sources widget can always show something true, and a dead scraper degrades one panel, never the app.

Two shared writers in `lib/items.ts` do all the row work:
- `upsertItems(source, rows, scope)` — insert-or-update by id, clear `deleted_at`, then **soft-delete everything of that source inside `scope` that wasn't in this batch**. The scope is the key subtlety: Canvas passes "assignments in tracked courses," Google passes "events in the synced window," Todoist passes nothing (open tasks are authoritative; whatever disappeared was completed).
- `replaceCourseContent(courseId, kinds, rows)` — hard replace per course and kind.

After a successful Canvas or Gradescope run, the runner fires two **after-hooks**: dedup, then (if enabled) the Todoist push. Failures there are logged, never propagated.

One lesson baked into the jobs ingester (DECISIONS 024): the first prod deploy rewrote 16k identical rows an hour with an fsync each and took the box down. Now it diffs fingerprints and writes only changes in one transaction. The rule for any new ingester: **batch, diff, one transaction per run.**

## Effective items: the read path

Widgets never read `items` directly. Every read goes through `GET /api/items` → `queryEffectiveItems` in `lib/effective.ts`, the brain of the backend. Given a window/kind/course filter, it:

1. Selects the rows, then loads side data in one batch: overrides, links, Todoist mappings, courses, source statuses.
2. Decides **health**: is the Canvas cookie source connected and successful in the last 2 hours? If yes, drop all `canvas_ical` rows (the iCal feed only fills gaps while the cookie is dead).
3. Drops Todoist rows flagged as mirrors (the pushed copies of assignments).
4. **Collapses linked pairs** to one row: the Gradescope side if the course's `submits_via` is gradescope, otherwise Canvas. The other id goes in `linkedIds`.
5. Computes `effectiveDone` = own status in {submitted, done, late, graded} OR override.done OR a closed Todoist mirror OR any linked partner is done. `effectiveHidden` = override.hidden or snoozed. `informational` = TA-course row, or a Gradescope row in a canvas-authoritative course.
6. Filters those out unless the caller asked for them, attaches `{id, code, color, role}` of the course, sorts by due then start.

If you change anything about what "done" or "duplicate" means, this is the one function to change, and everything downstream (todo, calendar, progress rings, Todoist push, grades) inherits it.

## Cross-source logic

**Dedup** (`sync/dedup.ts`): per course, skip if `submits_via=canvas`. Otherwise normalize titles (strip course code, hw/homework→hw, drop leading zeros), score every Canvas×Gradescope pair with bigram similarity, penalize different numbers in the title and due dates >24h apart, keep pairs ≥0.6 greedily one-to-one. Rewrite auto links; leave manual links alone.

**Todoist push** (`sync/todoist-push.ts`): off by default. Two phases, deliberately split. `planPush` is read-only: fetches effective assignments (not informational, not iCal, due within −30/+120 days), reads Todoist's open + recently completed tasks, rebuilds any missing mappings from the `collected:<itemId>` marker in task descriptions, and emits a list of `create / update / close / delete` ops with reasons. `executePush` applies them one at a time, recording each in the map. Rules the code enforces: done only ever closes, never reopens; a task you deleted by hand is left alone; source owns title/due/labels; an assignment soft-deleted at the source deletes its still-open task. The marker is the safeguard against duplicate tasks if the DB is lost. Preview in settings = plan without execute.

**Grades** (`lib/grades.ts`): nothing stored. Recomputes Canvas-style from assignment groups + scores on request, with a per-course override for hand-typed syllabus weights and title regexes. Canvas's own number is returned alongside so disagreement is visible.

## The API

Thin and resource-shaped. One file per route group under `api/`, mounted in `api/index.ts`. Routes mostly do: parse → validate → one or two Drizzle calls → JSON. The heavy logic lives in `lib/` and `sync/`, not in handlers, so the CLI and the after-hooks call the same functions.

Validation: request bodies go through `parseBody(c, zodSchema)`; the schemas live in `shared/src/schemas.ts` and the response types in `shared/src/types.ts`. **`shared/` plus `web/src/lib/queries.ts` is the entire browser↔server contract.** Errors are always `{error: "message"}` with 400/404/409/422/500.

Two shape notes: `POST /api/sources/sync` returns 202 immediately and the browser polls `GET /api/sources` for the `running` flag (long operations don't block requests), and Canvas files are served by 302-redirecting to Canvas's own CDN link so zero file bytes pass through the box (1 GB/month egress budget).

## Auth and secrets

There is no login code. Cloudflare Access sits in front of the tunnel, checks your email, and attaches a signed JWT; the server middleware verifies it against Cloudflare's JWKS on every `/api` request. `AUTH_DISABLED=true` in dev. Two routes bypass it: `/api/health` (Docker's healthcheck runs inside the container with no JWT) and the Canvas cookie drop-off (authenticates with a shared `LOCAL_HELPER_KEY` from the Mac script).

Credentials are AES-256-GCM encrypted into `sources.config_enc`. The key is `data/.secret_key`, created on first boot and living beside the database in the same volume, because a recreated `.env` once lost the key and every credential with it (DECISIONS 022). A key mismatch is a visible `needs_auth` state, not a silent disconnect.

## How it gets to production

`tsup` bundles the server (shared package inlined), Vite builds the web, a multi-stage Dockerfile produces one image running as the `node` user with `/data` as a volume. Compose runs it on `127.0.0.1:3000` with a heap cap of 384 MB. The box is a GCP e2-micro (1 GB RAM, ~45 write IOPS) that **cannot build the image**, so the image is built elsewhere (GitHub Actions on push to main; or the Mac by hand), shipped as a tarball, `docker load`ed, `compose up`. `cloudflared` on the box dials out; no ports are open except SSH. Migrations apply when the container starts, so schema and code always ship together.

## What's load-bearing vs cheap to change

**Expensive to change** (the web app or other tables depend on it):
- The `source:externalId` id convention. Links, overrides, mappings, and browser caches all key on it.
- The `queryEffectiveItems` semantics. Every widget's notion of done/hidden/duplicate.
- Route paths and JSON shapes in `shared/`.
- Soft-delete-within-scope in `upsertItems`. Break it and overrides point at vanished rows or ghosts reappear.
- The `status` vocabularies (`needs_auth` vs `error` especially; the UI treats them differently).

**Cheap to change:**
- Anything inside one ingester's client/map, as long as it emits the same rows.
- New per-source detail: put it in `raw`, no migration.
- Adding a source: a folder, an `Ingester` object, one line in the registry, one id in `INGESTED_SOURCE_IDS`, a config schema in `shared`. The runner, scheduler, CLI, and Sources widget pick it up.
- Adding a route: a file in `api/`, one `api.route(...)` line.
- Changing how files get sorted: `shared/src/file-sync.ts` is the one decision function; the server, the UI, and the agent all call it.
- The scheduler, the ORM, the logger. Nothing else knows about them.

**Known soft spots:**
- `queryEffectiveItems` does a full mirror scan (`select … where source='todoist' and status='done'`) on every call. Fine now; would want an index or a precomputed flag if items grew 10×.
- `GET /api/grades` runs a handful of queries per course per call, no cache.
- Everything is single-process in-memory state (the running-mutex `Set`, the JWKS cache). A second replica or a separate worker process would need those moved to the DB.
- The only thing the box is billed for is egress past 1 GB/month, and egress is API polling through the tunnel. Responses are gzipped and ETagged (DECISIONS 036); if the bill shows egress again, the next levers are trimming `raw` from item payloads and the poll interval.
- SQLite with `synchronous=NORMAL` can lose the last few commits on power loss (never corrupt). Acceptable because source rows are re-fetchable, but overrides and job_state are *not*, and the nightly backup cron is still not set up on the box.
