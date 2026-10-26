# collected — design

Personal dashboard that pulls every source a student juggles into one place, links each item back to where it came from, and keeps "is it done" trustworthy.

Single user (Priyam). Built selfishly. Generalize later, if ever.

## Goals

- One place to look: the next week across assignments, events, and todos.
- Every item links back to its source.
- Done state is honest: submitted work disappears without manual bookkeeping.
- Every source is opt-in and fails independently. A dead scraper degrades one panel, never the app.
- Layout is rearrangeable without a rewrite.

## Non-goals for v1

Multi-user. Discord. Piazza / Ed. Email. Health. Auto-applying to jobs. Pinloop (evaluate later).

## Architecture

One long-running Node process, one SQLite file:

- **Hono** HTTP server: JSON API, and serves the built SPA from `web/dist`.
- **Scheduler** (croner): runs each ingester on its own interval, in-process.
- **SQLite** via better-sqlite3 + Drizzle. File lives on a Docker volume.

Frontend: **Vite + React + TypeScript** SPA. Tailwind + shadcn/ui. TanStack Query polls the API per widget.

Exposure: **Cloudflare Tunnel** from the host to `collected.priyamkabra.com`, with **Cloudflare Access** in front (email allowlist; Google login and/or one-time PIN). The app verifies the Access JWT on every request. Nothing of the app runs on Cloudflare. Cloudflare is DNS, tunnel, and login wall only. `priyamkabra.com` stays on GitHub Pages, untouched.

Host: Ubuntu VPS running Docker Compose (`app` + `cloudflared`). The same compose runs on any always-on box, including a home machine later.

Mac-side: `collected connect canvas` (the `agent` CLI) reads the Canvas session cookie from a local browser and posts it to the app. Later, the resume pipeline.

```
Browser cookie ─(collected connect canvas)─────┐
                                              ▼
Canvas REST (session cookie) ─┐        ┌──────────────┐        ┌──────────┐
Canvas iCal (fallback) ───────┤        │  ingesters   │        │          │
Gradescope (HTML scrape) ─────┼───────▶│  on a timer  │───────▶│  SQLite  │
Google Calendar (OAuth) ──────┤        └──────────────┘        │          │
Todoist API ──────────────────┤                                └────┬─────┘
Simplify listings.json ───────┘                                     │
                                                                    ▼
             Todoist ◀──(one-way push)──┐                    ┌────────────┐      ┌────────────────┐
                                        └────────────────────│  Hono API  │◀────▶│  React SPA     │
                                                             └────────────┘      │  grid + widgets│
                                                                    ▲            └────────────────┘
                                                     Cloudflare Tunnel + Access
```

## Repo layout

```
collected/
  artifacts/        docs only: DESIGN, DECISIONS, SETUP, PROGRESS, seed-config
  server/           Hono API, ingesters, scheduler, CLI      (TypeScript)
    src/
      index.ts      boot: migrate, start scheduler, start http
      cli.ts        `pnpm sync <source>`, `pnpm push todoist`, etc.
      db/           drizzle schema + migrations
      ingest/       canvas.ts  canvas-ical.ts  gradescope.ts  gcal.ts  todoist.ts  jobs.ts
      sync/         todoist-push.ts  dedup.ts
      api/          route modules
      auth/         cloudflare-access.ts
      lib/          crypto.ts  http.ts  log.ts
  web/              Vite React SPA
    src/
      widgets/      one folder per widget + registry.ts
      dashboard/    grid, edit mode, layout persistence, size hook
      settings/     sources, courses, todoist, jobs, layout
      lib/          api client, query hooks
  shared/           types shared by server and web
  agent/            laptop agent + CLI: course files → folders, dashboard reads/edits, `connect canvas` (launchd)
  docker-compose.yml
  Dockerfile
  .env.example
  CLAUDE.md
```

pnpm workspaces: `server`, `web`, `shared`, `agent`.

Dev: Vite on 5173 proxies `/api` to the server on 3000. Prod: server on 3000 serves both.

## Data model

All times stored as ISO-8601 UTC strings. IDs are text.

**sources** — one row per integration.
`id` (canvas | canvas_ical | gradescope | gcal | todoist | jobs), `enabled`, `status` (disconnected | connected | needs_auth | error), `last_run_at`, `last_success_at`, `last_error`, `config_enc` (encrypted JSON: tokens, cookies, credentials), `meta` (JSON: non-secret settings like calendar ids, label names).

**courses** — the per-class personalization layer.
`id`, `term` ("2026-fall"), `code` ("CMSC422"), `section` ("0101"), `name`, `role` (student | ta), `canvas_course_id`, `gradescope_course_id`, `submits_via` (canvas | gradescope | both), `color`, `links` (JSON array of `{label, url}`), `schedule` (JSON: meetings, discussion, office hours), `notes`, `archived`.

**items** — the unified feed.
`id`, `source`, `external_id`, `kind` (assignment | event | task | announcement), `course_id?`, `title`, `description?`, `url?`, `starts_at?`, `ends_at?`, `due_at?`, `all_day`, `status` (open | submitted | done | missing | late | graded | cancelled), `points?`, `score?`, `labels` (JSON array), `raw` (JSON), `first_seen_at`, `updated_at`, `deleted_at?`.
Unique on (`source`, `external_id`). Soft-delete when a source stops returning an item.

**item_links** — same real-world thing seen by two sources.
`a_item_id`, `b_item_id`, `method` (auto | manual), `confidence`.

**overrides** — user edits on top of source data.
`item_id`, `hidden`, `done`, `snoozed_until?`, `note?`.

**todoist_map** — push-sync bookkeeping.
`item_id`, `todoist_task_id`, `last_pushed_hash`, `closed_by_us`, `created_at`.

**jobs**
`id`, `source` (simplify | vanshb03), `external_id`, `company`, `title`, `locations` (JSON), `url`, `terms` (JSON), `sponsorship`, `degrees` (JSON), `posted_at`, `active`, `matches_filter`, `score?` (v2), `first_seen_at`, `updated_at`.

**job_state** — the tracker. One row per job the user touched.
`job_id`, `state` (new | starred | hidden | applied | screen | interviewing | offer | rejected | ghosted | withdrawn), `notes?`, `resume_path?`, `seen_at?`, `applied_at?` (YYYY-MM-DD, stamped once when the state first reaches applied or later), `next_action?`, `next_action_at?`, `updated_at`. `new` is untracked, `hidden` is dismissed from the feed; everything else shows in the Applications widget. Jobs added by hand are `jobs` rows with `source = manual`; they never appear in the feed and can be deleted, unlike feed rows, which are hidden so the next sync doesn't resurrect them.

**Manual items** — `items` rows with `source = manual`: exam, quiz, and final dates, cancelled or virtual sessions, notes on a day. `kind = event`, `raw` is `ManualEventRaw` (`eventKind`, `date`, `start`/`end` or all-day, `location`, `note`, `meetingKind` for session tags). No `sources` row and no ingester; `INGESTED_SOURCE_IDS` is the list with ingesters. Written through `POST/PUT/DELETE /api/items/manual`.

**Grades** — two more `course_content` kinds from Canvas: `grade_group` (assignment group: `raw.weight`, `raw.rules` with drop_lowest etc.) and `grade_summary` (the enrollment's computed current/final score and whether Canvas applies weights). Assignments carry `raw.groupId`, `raw.omitFromFinal`, `raw.excused`. `courses.grading` (nullable JSON, `GradingConfig`) overrides the categories: `mode: manual` with `{ name, weight, groupIds, match (title regex), dropLowest }` per category. `lib/grades.ts` computes the current grade Canvas-style; nothing is stored.

**file_sync_state** — one row per (course, Canvas file) the sync has an opinion about: `manual_target?` (the user's override, `skip` allowed), `model_target?` + `model_confidence?` + `model_probabilities?` + `model_at?` (what the agent's classifier said), `placed_target?` + `placed_path?` + `placed_device?` + `placed_at?` (where the agent last put it). Rule decisions are not stored; they are derived from `courses.file_sync` on every read so editing a rule re-sorts.

**widget_instances** — `id`, `type`, `config` (JSON), `hidden`.
**layouts** — `breakpoint` (lg | md | sm), `layout` (JSON array of `{i, x, y, w, h}`).
**settings** — key/value JSON.

## Ingesters

Each ingester is a module with `run(ctx)` and is also a CLI command. Every run is wrapped: timeout, try/catch, writes `status` / `last_error` / `last_success_at` to `sources`. A run upserts items by (`source`, `external_id`), touches `updated_at`, and soft-deletes items it no longer sees within its window.

| Source | Interval | Auth | Pulls | Failure mode |
|---|---|---|---|---|
| canvas | 15 min | session cookie jar, persisted back after every run | courses (active enrollments), planner items (assignments + events with submission state and planner overrides), assignments per course, announcements, syllabus body, module items and files (for class widget) | redirect to login or HTML instead of JSON → `needs_auth`; app falls back to `canvas_ical` |
| canvas_ical | 60 min | per-user feed URL | assignments and events, no done state | stale feed → `error` |
| gradescope | 30 min | native email + password; session cookie persisted, re-login only on redirect to `/login` | courses (student and TA), assignments with due dates, release dates, submission status, scores; for TA courses, grading progress | login failure → `needs_auth`; HTML shape change → `error` with the failing selector |
| gcal | 5 min | OAuth refresh token; app publishes consent screen to avoid 7-day expiry | events from selected calendars, incremental via sync tokens; write: create/update events | invalid_grant → `needs_auth` |
| todoist | 5 min | API token, unified API v1 (`api.todoist.com/api/v1`) | projects, sections, labels, tasks (open + recently completed) | 401 → `needs_auth` |
| jobs | 60 min | none | Simplify `Summer2027-Internships` and `New-Grad-Positions` `.github/scripts/listings.json` on `dev`; optional vanshb03 mirror; diff by id | fetch error → `error` |

Canvas notes: strip the `while(1);` prefix; follow `Link` header pagination with `per_page=100`; respect `X-Rate-Limit-Remaining`. The cookie jar must be updated from `Set-Cookie` on every response and saved, or the session dies after a day. Writes (planner overrides, later) send `X-CSRF-Token` from the `_csrf_token` cookie.

Gradescope notes: login is `POST /login` with `authenticity_token` from the form. Course list from `/account`. Assignments from `/courses/{id}`; parse the assignments table, `<time datetime>` for dates, status cell for submitted / no submission. Normal browser user agent. Never log in more than once per run.

## Dedup and done state

Rule is per course, driven by `courses.submits_via`:

- `gradescope`: Gradescope items are authoritative. Canvas items in that course surface only if no Gradescope item matches.
- `canvas`: Canvas authoritative. Gradescope items in that course are visible in the class widget but never become tasks.
- `both` (default until configured): items from both sources are fuzzy-linked; when linked, done = either says done; unlinked items from either source surface.

Fuzzy match: same course, normalized title similarity above threshold, due dates within 24h. Auto links get `method=auto`; the settings panel can add or break links (`manual`).

Effective done for an item = source status in {submitted, graded, late, done} OR linked item done OR override.done OR its mirrored Todoist task is closed. Effective visibility = not hidden, not snoozed, not effectively done (unless a widget asks for done items), not informational (unless asked).

Linked pairs collapse to one row: the Gradescope side when `submits_via=gradescope`, otherwise the Canvas side; the survivor carries `linkedIds`. `submits_via=canvas` never links and marks Gradescope rows informational. The iCal fallback only fills gaps: its rows are hidden while the cookie source is healthy, and never shown for an assignment the cookie source already has.

Timezone rule: everything is stored as UTC ISO strings. The server computes windows ("today", planner ranges) in Node local time, so `TZ` is set in `.env` and in `docker-compose.yml`. The web renders in the browser's zone. All-day items are stored as local midnight.

## Todoist push sync (opt-in module)

Direction: store → Todoist, never back. Todoist-side changes never modify Canvas or Gradescope.

- Every effective assignment (after dedup) becomes one Todoist task in project **School**, labels `homework` + lowercase course code (`cmsc422`), due at the assignment due time, description = source link + a marker line `collected:<source>:<external_id>`.
- The marker makes the map rebuildable by scanning Todoist, which is the guard against duplicates if the DB is lost.
- Done only moves toward closed. Source done + task open → close it (`closed_by_us=true`). Task closed by hand + source not done → leave it. Never reopen.
- Source title or due date change → overwrite the task's. Sources own those fields.
- Assignment soft-deleted → delete the task if open, leave it if closed.
- Runs after every canvas / gradescope run. Batches writes via the sync endpoint.

The todo widget reads the unified store, not Todoist, so the homework section works with the push sync off.

## File sync to a laptop (agent)

Course files land in folders on the laptop automatically, so local tools (Claude Code over lecture notes, a PDF reader) see them without hand downloads. Three facts shape it: the server can't write to a laptop, the browser can't either unattended, and the box must not carry file bytes (egress). So a small **agent** runs on the laptop under launchd and the bytes go Canvas CDN → laptop; the server only knows files, rules, and decisions.

**Split.** The server stores, per course, `courses.file_sync`: `{ enabled, targets: [{ name, description }], rules: [{ target, folder?, module?, name?, largerThanMb?, linked?, flatten }], fallback: model | unsorted | skip, threshold, skipHint }`. Targets are *names* with a one-line description (`slides: "lecture slides and notes"`). Local **paths** live only in the agent's config (`~/.collected/agent.json`): per course a `root`, optional per-target overrides (relative to the root), an `index` file, and a `facts` folder; an unmapped target defaults to `<root>/<name>`. A web page cannot learn a filesystem path, and a path belongs to a device, not to the course.

**Deciding where a file goes**, in precedence order: a manual override; the first rule whose conditions all match (`folder` against the Canvas folder path, `module` against the module name, `name` against the Canvas *display* name, case-insensitive regexes; `largerThanMb` against the size); the model's choice if its confidence is at or above `threshold`, else `unsorted`; otherwise the fallback. `skip` is a reserved target meaning "don't place". `unsorted` is a reserved target the UI surfaces for one-click correction; a correction can be turned into a rule. Nothing is dropped silently: skipped files are listed with their ids in the course index and can be fetched with `collected-agent pull`.

**Files that only exist as links.** A course's Files tab lists what the instructor left visible; a syllabus PDF or an assignment's spec often sits in a hidden folder and is reachable only through a link in a page body. The Canvas ingester collects file ids linked in assignment descriptions, the syllabus body, announcements, and module items of type File; anything not in the listing is looked up by id (one request each, capped per course, a denied lookup means "locked", never "session dead") and stored as a file row with `linkedFrom: { kind, title }`. Rules can match on it (`linked`), and an assignment's attachment gets the assignment as its folder, so the defaults read: linked from the syllabus → `Admin/`, linked from an assignment → `Assignments/<assignment title>/`. A `linked` rule never matches a file from the Files tab, so listed files don't move when a page also links them.

**What gets skipped** is policy, written as rules (the set agreed for the Obsidian class-notes vault, DECISIONS 040): archives, source code and starter-code trees, HTML widgets and media, datasets and binaries, text/CSV/JSON over 1 MB, readings over 30 MB. Kept: PDFs, lecture notebooks, Markdown/text handouts.

**The model** is a System 1 decision model called over HTTP from the agent: TypeSafe's hosted **Jev** by default (`POST /v1/systemone`, bearer key, ~200 input tokens per file at $0.042 per million), only for files with no rule or manual decision in courses whose fallback is `model`. Subject = `{ title, filename, folder, module, type }`; criteria = the targets' descriptions plus `skip` with the course's `skipHint`. It returns the choice with calibrated probabilities; the agent reports both, and the server applies the threshold on read so changing it re-sorts without re-running. `laya-serve` (the open-weight Laya model) speaks the same shape, so a local, free alternative is a `baseUrl` change in the agent's config (DECISIONS 039).

**Layout.** A file's home is `<target folder>/<Canvas subfolders>/<Canvas display name>`. Subfolders mirror Canvas (`/p1/INSTRUCTIONS.md` → `Assignments/p1/…`, `/Blank Notes/x.pdf` → `Slides/Blank Notes/x.pdf`) unless the matching rule has `flatten`, which says the top-level Canvas folder is the category itself and drops it (`/Lecture Notes/x.pdf` → `Slides/x.pdf`, `/Readings/Unit 1/x.pdf` → `Readings/Unit 1/x.pdf`). Display names, not upload names: the upload name is URL-encoded and often unrelated (`Chapter4+2.pdf` for "Lecture9_Sept29.pdf"), and display names are unique within a course. A name collision gets Canvas's updated date as a suffix, then a number. A Canvas Markdown file is written with frontmatter (`source: canvas`, `canvas_id`, `canvas_path`, `updated`) under a name from its first heading, because in a notes vault a `.md` is a note.

**Agent run** (`collected-agent sync`, every 30 min, `--dry-run` for a plan): pull `GET /api/file-sync/manifest` → classify pending files → reconcile each file with the disk → write the course index and facts → run the `onPlace` hook once if anything landed or moved (env: `COLLECTED_PLACED`, `COLLECTED_COURSES`, `COLLECTED_COURSE_ROOTS`) → `POST /api/file-sync/report`. Downloads go to a **staging cache** (`~/.collected/cache/<course>/<fileId>-<version>/<name>`) via `/api/canvas/files/:id/open`, following the 302 to the CDN *without* forwarding auth headers; the vault gets a hard link or (for folders a sync service owns) a copy.

**Reconcile rules**, the part that makes it safe to point at a folder someone else also uses:
- *Never a second copy.* Before writing, any file anywhere under the course root (outside `_data` and dot-folders) with the same bytes is **adopted**: the placement points at it under whatever name it has, and it is the user's from then on: never moved, renamed, replaced, or removed. A copy the agent placed earlier that turns out to duplicate a user file is folded onto it.
- *Ours and untouched* (sha256 still matches what was placed): follows the layout (renamed or moved when the display name, target, or rule changes) and follows Canvas (a new version replaces it in place).
- *Edited by the user*: never touched. A new version lands beside it as `name (v2).ext`; a re-sort leaves it and says so.
- *Deleted by the user*: stays deleted until Canvas changes the file.
- *Removed from Canvas*: stays on disk, listed under "Removed from Canvas" in the index.
- *Writes* are temp file + rename, with mtime set to Canvas's `updated_at`, and happen only when something changed, so tools keyed on mtime (the vault's extractor) see a change only when Canvas made one. Folders emptied by a move are removed.
- A hard size cap (`maxFileMb`, default 100) keeps a lecture video out of a synced folder regardless of rules.

**Index and facts.** Per course, in the agent-owned files (written only when their content changes): `canvas.md`, the file → Canvas mapping (saved-to, module, module order, Canvas path, updated, size, Canvas file id; adopted files marked; sections for removed and not-synced files); `assignments.md`, one row per effective assignment with due time in local and UTC, points, status, score, source, submission types, link, then the description text; `announcements.md`, the ten newest; `syllabus.md`. PDFs rarely carry due dates; collected already has them. Without an `index` path the agent writes a `_collected.md` per folder instead.

**On demand.** `collected-agent pull <canvas-file-id> --to <folder>` fetches one file whatever the rules say, with the same dedupe and atomic write, and the sync keeps it afterwards.

**Auth.** The agent authenticates through Cloudflare Access with a **service token** (`CF-Access-Client-Id/Secret` headers; Access mints a JWT whose identity is `common_name`, which the app accepts like an email). `LOCAL_HELPER_KEY` in `x-collected-key` opens exactly one route, the Canvas cookie drop-off; a service token can read, make the CLI's edits and run the file sync, but not import/export, credentials, settings, layout, OAuth, or delete (DECISIONS 043).

## The `collected` CLI

The dashboard from a terminal, for a person or for an agent working in another folder (the class-notes vault). It lives in the `agent` workspace because that already holds the laptop's credentials for the API; one binary, `collected` (`collected-agent` is the same file). Every read prints a plain table, or JSON with `--json`. `collected help` lists everything.

- **Look**: `courses`, `course <c>`, `assignments [--course --days --all]`, `agenda [--days]`, `todo`, `grades [c]`, `announcements`, `dates`, `sources`, `jobs`.
- **Change**: `task add "<text>"` (Todoist quick add) and `task done`, `done <item> [--undo]` (a dashboard-only override), `link add|rm`, `schedule set|rm` (`"mon,wed 14:00-14:50 @ CHE 2110"`), `notes set|clear`, `date add|rm` (exams, quizzes, finals, cancelled or virtual sessions), `jobs set <id> <state>`, `resync [source|all]`.
- **Canvas, read-only**: `canvas ls <c> [modules|files|pages|assignments|announcements]`, `canvas show <c> syllabus | page <slug> | assignment <id> | announcement <id>` (the full body as text, the rubric, and the ids of files it links), `canvas get "<api path>" [--all]`, and `pull <file-id> --to <folder>`.
- **Connect**: `connect canvas [--browser chrome|brave|edge|arc|chromium|firefox] [--domain host] [--dry-run]` reads the Canvas session cookie (`canvas_session` / `_normandy_session` / `_legacy_normandy_session`) out of the local browser's cookie store — decrypting Chromium's Keychain-encrypted store in `agent/src/browser-cookies.ts` with no external dependency (`node:sqlite`, `node:crypto`) — and posts it to `POST /api/sources/canvas/cookie`, which stores it and runs a Canvas sync. Only the session cookies leave the machine; values are never printed. Replaces the old Python `local/canvas_cookie.py`.
- **File sync**: `sync`, `status`, `files courses|link|unlink`, `install-launchd`.

A `<course>` is its code, the digits, or the id. A course edit reads the course, changes one field, sends only that field (DECISIONS 041), and prints what it was and what it is now. The Canvas commands go through `GET /api/canvas/raw?path=/api/v1/…[&all=1]`: one GET with the stored session, JSON passed through, path restricted to the Canvas API on the configured host, a denied resource reported as missing without touching the source's status. No Canvas credential exists on the laptop, and nothing in the CLI can write to Canvas or Gradescope.

## Widget system

**Grid**: react-grid-layout, `ResponsiveGridLayout`. Columns 12 (lg) / 8 (md) / 4 (sm, phone: effectively a stack). Row height 40px. Layouts saved per breakpoint to `layouts`, debounced.

**Edit mode**: a toggle in the header. Normal mode: widgets are static (`isDraggable=false`, no resize handles), so touch scrolling never moves a widget. Edit mode: drag handle on each widget header, resize handle bottom-right, hide button, and a bottom tray listing hidden and addable widgets. Leaving edit mode saves.

**Registry**: `web/src/widgets/registry.ts` exports a map of widget definitions:

```ts
type WidgetDef = {
  type: string;                 // 'calendar' | 'todo' | 'sources' | 'class' | 'jobs' | ...
  name: string;
  icon: LucideIcon;
  requires: SourceId[];         // renders "connect X" placeholder if any is disconnected
  presets: { label: string; w: number; h: number }[];  // e.g. S 3x2, M 6x4, L 12x6, Tall 3x6
  min: { w: number; h: number };
  max?: { w: number; h: number };
  multiInstance?: boolean;      // class widget: one per course
  configSchema?: ZodSchema;     // rendered as a form in settings
  Component: React.FC<WidgetProps>;
};
```

Adding a widget = adding a folder and a registry entry.

**Side pane**: widgets stay small; detail lives in one app-wide right-hand sheet (`web/src/panes/`). `usePane().open({ kind, ... })` from anywhere. Kinds: `course` (overview; assignments split to-do/done or upcoming/past for TA courses; grades: categories, weights, drop rules, a weight editor; dates: month grid with class days shaded, exam/quiz/final entries, cancelled/virtual session tags; modules and files; announcements; syllabus), `job` (posting details plus the tracker fields, saved on blur), `job-new` (manual entry form). Courses open from the classes overview, the class widget header, and the course code in item popovers; jobs open from feed and tracker cards.

**Canvas files**: file links never point at Canvas's download URL. `/api/canvas/files/:id/open` asks Canvas for the file's `public_url` (an InstFS link without `download=1`) and redirects; the CDN serves it inline, so PDFs render in the browser. `?download=1` forces a download. Module items of type File carry the file id in `raw.contentId` and use the same route. A plain click on a PDF or image opens it in a preview dialog (`panes/FilePreview.tsx`, an iframe or `<img>` on the same route; the CDN sends no frame restrictions and serves byte ranges, so Chrome's viewer streams it with nothing passing through the server) with Open-in-tab and Download buttons; cmd-click or any other file type goes straight to a new tab.

**Look** (the `new-ui` branch, from the "Collected Dashboard v2" Claude Design file): one small token set drives everything. Surfaces `--bg / --card / --well / --well2`, text `--ink / --sub / --ter`, accents `--indigo / --teal / --amber / --lime / --coral`, plus `--shadow` and `--glow`; light values on `:root`, dark on `.dark`, and the shadcn names alias to them so stock components follow. Widgets are 18px `.surface` cards tinted from their registry `accent` (course colour for class widgets) with a well header; a widget puts its own controls in that header through `<WidgetHeader>` (a portal into the frame). Controls are pills: `.seg` segments, `.chip` filters, `.orb` round icon buttons. The pane is a floating 24px drawer over a blurred backdrop. The dashboard header is the date, a summary line (classes today, overdue, last sync or sources needing attention), Edit layout, refresh, theme, and an avatar with initials from `profile.initials`.

**Reflow**: every widget root sets `container-type: size`, so widget CSS uses `@container` queries against its own box. A `useWidgetSize()` hook (ResizeObserver) also returns `{ w, h, cols, rows, tier: 'xs'|'sm'|'md'|'lg', aspect: 'tall'|'square'|'wide' }` for structural switches. Presets in the add tray snap to sizes each widget was designed for; free resize within min/max still works.

**v1 widgets and their tiers**

- **calendar** (gcal + todoist due dates + assignments): view auto-picked from the box (next-up, agenda, 7-day strip, week grid with a due/all-day lane, month) with a manual override; prev/today/next; quick-add popover writes through to Google and appears immediately.
- **todo** (unified items of kind task/assignment, grouped by section = label): narrow = one section with tabs; wide = sections as columns. Homework section is fed by effective assignments plus Todoist tasks carrying the homework label. Check-off writes an override for source items and closes the task for Todoist items. Quick-add box uses Todoist's natural-language parser.
- **sources**: xs = colored dots; md = table with status, last success, error, and per-source actions (sync now, reconnect).
- **class** (multi-instance, config: course_id): header with code + color + next meeting; hotlinks row from `courses.links`; upcoming assignments; recent announcements; for TA role: grading queue and discussion time. sm = links + next due; lg = full.
- **classes**: one row per course (code, current grade, next due, hotlinks, next meeting). Clicking a course opens the course pane.
- **jobs**: short and wide = horizontal tape of matches; otherwise a card grid (1–3 columns by width). Star / hide / applied actions; starred-only and all-listings toggles; header shows new / match / active counts. Cards on screen for two seconds are marked seen, which drives the "new" count. Clicking a card opens the job pane; the external-link icon goes to the posting.
- **progress**: what's done of what was due this week or month, as nested rings per course (Todoist tasks are one more ring) with the overall figure in the centre, a legend, and a bar list when wide. Clicking a course opens its assignments.
- **exams**: countdown to every exam, quiz, and final across courses: hand-entered dates plus assignments titled like one, days-until tiles that turn coral or amber inside three days, a this-week pill in the header.
- **announcements**: every course's announcements newest first; unread is tracked per browser in localStorage (Canvas exposes nothing worth syncing), opening one clears it, Mark all read in the header.
- **clock**: analog when the box is roughly square, digital otherwise, pinnable per instance (`config.style`, `config.hour24`); shows the soonest scheduled session across courses, honouring cancellations.
- **tracker** ("Applications"): every job with a tracked state. Wide = a board with a column per open stage (saved, applied, screen, interviewing, offer) and an optional closed column; narrow = one list with stage pills. Cards open the job pane; a stage select on each card moves it without opening. "Add" opens the manual-entry form.
- **settings** is a page, not a widget: sources (connect, paste cookie, credentials, Google connect button), courses editor (schedule drawn on a week grid, JSON one click away; session kinds are open, lecture / discussion / lab / office_hours built in and any snake_case key accepted, labelled by `meetingLabel()`), todoist sync options, job filter, layout reset, JSON export/import.

## API

```
GET  /api/items?from&to&kind&course&includeDone
POST /api/items/:id/override           { hidden?, done?, snoozed_until?, note? }
POST /api/items/link  /api/items/unlink

GET  /api/sources
PUT  /api/sources/:id/config           (secrets encrypted at rest)
POST /api/sources/sync                 (start every enabled source; 202, runs continue in background)
POST /api/sources/:id/sync             (run now)
POST /api/sources/canvas/cookie        (from `collected connect canvas`)

GET  /api/google/start  GET /api/google/callback
POST /api/calendar/events              (write-through to GCal)

GET/PUT /api/courses  /api/courses/:id
GET/PUT /api/layout   GET/PUT /api/widgets
GET  /api/jobs?state&matchesOnly       PATCH /api/jobs/:id/state   { state?, notes?, appliedAt?, nextAction?, nextActionAt?, resumePath? }
GET  /api/jobs/tracked  GET /api/jobs/:id  POST /api/jobs (manual entry)  DELETE /api/jobs/:id (manual only)
GET  /api/canvas/files/:id/open?download  (302 to a one-shot inline link)
GET  /api/canvas/raw?path=/api/v1/…&all   (read-only Canvas API passthrough for the CLI)
POST /api/items/manual  PUT/DELETE /api/items/manual/:externalId   (course dates and session tags)
GET  /api/file-sync/manifest   (agent: enabled courses, files, effective decisions)
POST /api/file-sync/report     (agent: model decisions, placements, device target map)
GET  /api/file-sync/courses/:id   PUT /api/file-sync/courses/:id/files/:fileId { target|null }   (web: decisions, manual override)
GET  /api/file-sync/devices    (web: per-device last run and target paths)
GET  /api/grades  (current grade per course)  GET /api/grades/:courseId  (categories, assignments, Canvas's own numbers)
GET/PUT /api/settings
GET  /api/export  POST /api/import     (courses, settings, layout, widgets)
GET  /api/health
```

## Auth

Cloudflare Access sits in front of the tunnel. The server middleware verifies `Cf-Access-Jwt-Assertion` against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) and checks `aud` = the app's AUD tag. Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`. `AUTH_DISABLED=true` for local dev. No login UI in the app.

## Secrets and backups

- `SECRET_KEY` env (32 bytes hex). Source configs encrypted AES-256-GCM before hitting SQLite. Never logged.
- `.env` on the host only. `.env.example` in git.
- Backups: nightly `sqlite3 .backup` to `/srv/backups` on the host (host cron), rotate 14 days. Hetzner snapshot weekly. Later: rclone to Cloudflare R2.

## Scheduling and mobile

- Scheduler runs only in the main process; `SCHEDULER_DISABLED=true` for dev when you'd rather run ingesters by hand.
- Widgets poll every 60s while the tab is visible; pause when hidden.
- `sm` breakpoint stacks widgets in y-order; PWA manifest so it installs on the phone.

## Deferred (post-v1)

Job classifier with Haiku. Resume pipeline hookup. Pinloop as a second job source. Canvas write-back of planner overrides. Applications tracker widget. Piazza / Ed feed for the TA role. TerpLink events. Cookie auto-refresh via Playwright profile.
