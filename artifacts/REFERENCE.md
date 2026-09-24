<!-- Generated from the published reference artifact (https://claude.ai/code/artifact/d0a7ad88-df03-4dc0-bb34-14009cecb7b1). Edit either, keep them in step. -->

_Reference · written 2026-09-09, updated 2026-09-12_

# collected Internals

Everything the server stores, every request the browser makes, how the six data sources are read, and how the whole thing gets onto a box behind Cloudflare. Written so someone with limited code access could rebuild the backend and keep the app working.

Repo: priyam-k/collected · Server: Node 24, Hono, Drizzle, SQLite · Web: Vite, React 19, TanStack Query · Live: collected.priyamkabra.com

## What this app is

**collected** is a single-user dashboard for a UMD student who is also a TA. It pulls from five places you already use, Canvas, Gradescope, Google Calendar, Todoist, and a public list of internship postings, copies what it finds into one local database, and shows it as rearrangeable widgets: a calendar, a to-do list, one row per class, a job feed, an applications tracker, and a few smaller ones. Clicking into a class or a job opens a side drawer with everything about it.

The design principle behind all of it: **the app copies, it never owns.** Canvas remains the truth about assignments, Google about events, Todoist about tasks. The server keeps its own copy so the dashboard is fast and works even when a source is briefly down, and it re-copies on a schedule. The only things the app writes back to a source are deliberate: creating a calendar event, closing a Todoist task, and an opt-in one-way push of assignments into Todoist.

There is exactly one user, so there is no user table, no login form, and no permissions model. The login wall is Cloudflare Access in front of the whole site (chapter 13).

## Words you'll meet

Short definitions for terms the rest of this document uses without stopping. Skip if you know them.

- **API, route, endpoint** — The server exposes URLs like **/api/items**. The browser sends a request to a URL with a method (GET to read, POST to create, PUT to replace, PATCH to change part, DELETE to remove) and gets JSON back. Each URL plus method is a route.
- **JSON** — The text format every request and response uses: `{"title": "HW01", "dueAt": "2026-09-08T03:59:59.000Z"}`.
- **SQLite, table, row, column** — The database is one file on disk, **data/collected.db**. A table is like a spreadsheet: columns are the fields, rows are the records.
- **Migration** — A numbered SQL script that changes the tables. The server runs any it hasn't applied yet on every start, so a new column arrives with the code that needs it.
- **Upsert** — Insert a row, or if a row with that id already exists, update it instead. Ingesters upsert everything so re-running them is harmless.
- **Soft delete** — Instead of removing a row, set its **deleted_at** timestamp. Reads skip it; nothing is lost; a source that returns the item again restores it.
- **Ingester** — This project's word for the code that reads one source and writes rows. There are six. Each is also a command you can run by hand.
- **Source** — One of canvas, canvas_ical, gradescope, gcal, todoist, jobs, plus **manual** for things you type in yourself.
- **Item** — The unified record type. An assignment, calendar event, task, or announcement from any source, normalised to the same columns.
- **Effective item** — An item after the server has applied your overrides, linked duplicates, and Todoist mirrors to decide whether it counts as done or hidden. Chapter 6.
- **Cookie jar** — A stored set of browser cookies the server sends with requests so Canvas and Gradescope treat it as your logged-in browser.
- **OAuth, refresh token** — Google's way of letting an app act on your behalf. You approve once in a browser; Google hands the server a long-lived refresh token it trades for short-lived access tokens on every sync.
- **JWT** — A signed token. Cloudflare Access attaches one to every request that passed its login page; the server verifies the signature and reads your email from it.
- **Container, image, Compose** — Docker packages the built app plus its runtime into an image; a container is a running copy of it. Compose is a small file describing how to run that container with the right ports, folders, and environment.
- **Tunnel** — Cloudflare Tunnel: a program on the server that dials out to Cloudflare and keeps the connection open, so traffic for your hostname reaches the server without any port being open to the internet.

## The big picture

Three parts, one process. The **web app** runs in your browser. The **server** is one Node program that answers the web app's requests, serves the web app's files, and runs the ingesters on timers. The **database** is one SQLite file the server reads and writes. There is no separate worker, queue, or cache.

```
[Canvas: JSON API, session cookie]  [Gradescope: HTML pages, email + password]  [Google Calendar: REST API, OAuth]  [Todoist: REST API, token]  [Simplify jobs: public JSON on GitHub]
↓ ingesters read on timers (15 min, 60, 30, 5, 5, 60) ↓
[server · Node + Hono: /api routes · static files · scheduler · encryption]  [data/collected.db: SQLite, 12 tables, WAL mode · data/.secret_key]
↑ browser calls /api/… as JSON; polls every 60 s while visible ↑
[web app · React: widget grid · side drawer · settings]  [Cloudflare Access + Tunnel: login wall, TLS, no open ports]
```

### Two flows to keep in mind

**A page load.** Browser → Cloudflare edge (TLS ends here, Access checks you're logged in and attaches a JWT) → tunnel → the server on port 3000. The server checks the JWT on every `/api` request, then either answers from the database or serves a file from the built web app. Nothing in a page load talks to Canvas or Google; it all comes from the local copy.

**A sync.** A timer fires inside the server, the ingester for that source decrypts its stored credential, calls the source, converts what came back into rows, upserts them, soft-deletes anything the source stopped returning, and writes a status line (last run, last success, last error, counts) into the `sources` table. The Sources widget reads that line. After Canvas or Gradescope runs, two follow-ups run: duplicate matching between the two, and, if you turned it on, the Todoist push.

### Where the code lives

- `shared/` — Types and validation schemas both sides import. The contract between browser and server.
- `server/src/` — db/ (schema, client, migrator), api/ (one file per route group), ingest/ (one folder per source), sync/ (dedup, Todoist push), lib/ (effective items, grades, crypto, settings), auth/, scheduler.ts, seed.ts, cli.ts.
- `server/drizzle/` — The migration SQL files and their journal.
- `web/src/` — dashboard/ (grid, frame, header), widgets/ (one folder each), panes/ (drawer contents), settings/, lib/ (api client, query hooks, theme).
- `artifacts/` — DESIGN.md, DECISIONS.md, PROGRESS.md, SETUP.md, seed-config.json. Docs only.
- `local/` — canvas_cookie.py, the Mac helper that reads the Canvas cookie out of Chrome.

## Conventions the code relies on

These are the rules a rewrite must keep, because the web app assumes them.

### Ids

Every item id is `source:externalId`, where the external id is whatever the source calls the thing. Examples: `canvas:assignment:7775093`, `gradescope:assignment:8499802`, `gcal:primary:abc123` (calendar id, then event id), `todoist:9876543210`, `manual:6f1c…` (a random UUID). Jobs use `simplify:<uuid>` or `manual:<uuid>`. Courses use a slug of term, code, and section: `2026-fall-cmsc422-0101`. Course content uses `courseId:kind:externalId`. Ids are stable across syncs, which is what makes upserts and links work.

### Time

Instants are ISO 8601 strings in UTC, like `2026-09-08T03:59:59.000Z`, stored as text. Dates that are a day rather than a moment (applied-on, exam date, next-action date) are `YYYY-MM-DD`. The server process runs in the user's timezone (`TZ`, America/New_York), and the web app uses the browser's zone; they're the same for one user, so "local midnight" is unambiguous.

### Status vocabulary

| Field | Values | Meaning |
| --- | --- | --- |
| sources.status | disconnected · connected · needs_auth · error | Not set up · last run succeeded · the credential was rejected or can't be decrypted · the run failed for another reason. |
| items.kind | assignment · event · task · announcement | What the row is. Widgets filter on it. |
| items.status | open · submitted · done · missing · late · graded · cancelled | The source's own state. submitted, done, late, and graded all count as done. missing means past due and unsubmitted. |
| courses.role | student · ta | TA courses never produce homework; their assignments are informational and feed a grading queue. |
| courses.submits_via | canvas · gradescope · both | Which system is the truth for done state when both have the same assignment. Default both, with fuzzy linking. |
| job_state.state | new · starred · hidden · applied · screen · interviewing · offer · rejected · ghosted · withdrawn | new is untracked, hidden is dismissed from the feed, everything else shows in the tracker. applied and later stamp applied_at once. |
| manual event kinds | exam · quiz · final · cancelled · virtual · other | Stored in raw.eventKind on manual items. cancelled and virtual attach to a scheduled session. |

### Soft deletes and restores

Ingesters never hard-delete items. When a source stops returning something inside the ingester's scope (for Canvas, assignments in tracked courses; for Google, events in the synced window), `deleted_at` is set. If it comes back, the upsert clears it. The exceptions that hard-delete: manual events you delete, manual job entries you delete, course content, which is replaced wholesale per course, and job feed rows, which are never deleted at all.

### JSON columns and the raw bag

Several columns hold JSON as text: `items.raw`, `items.labels`, `courses.links`, `courses.schedule`, `courses.grading`, `sources.meta`, `course_content.raw`, `jobs.locations`, `jobs.terms`, `jobs.degrees`, `widget_instances.config`, `layouts.layout`, `settings.value`. The `raw` bag on items is where each source keeps details the shared columns don't have: which Canvas assignment group a homework is in, a Todoist task's project name, a manual event's kind. Chapter 7 lists the keys per source.

### Encryption

Credentials (Canvas cookie jar, Gradescope email and password, Google refresh token, Todoist token) are never in the environment file and never returned by any route. They live in `sources.config_enc`, encrypted with AES-256-GCM. The stored string is three base64 pieces joined by dots: the 12-byte nonce, the 16-byte authentication tag, the ciphertext. The 32-byte key is `SECRET_KEY` if set, otherwise the file `data/.secret_key`, created on first start with permission 600. Lose the key and every credential must be re-entered; the app detects this and marks the source needs_auth with a message saying so.

### Error shape

Every error response is `{"error": "message"}`. 400 for a bad request, 404 not found, 409 conflict (already exists, or an action needs a setting that's off), 422 when a body fails validation (the message lists the fields), 500 for anything unexpected.

## Every table, every column

Twelve tables. Types are SQLite's: `text`, `integer` (used for booleans as 0/1), `real`. "json" means text containing JSON. Timestamps are ISO text. Unless noted, `updated_at` is set on every write and `created_at` on insert.

**sources — one row per integration**

| Column | Type | Meaning |
| --- | --- | --- |
| id | text, primary key | canvas, canvas_ical, gradescope, gcal, todoist, jobs. Seeded on every start. No row for manual. |
| enabled | integer bool | Whether the scheduler runs it. Default 1. Setting a config re-enables. |
| status | text | disconnected · connected · needs_auth · error. Written by the runner after every run. |
| last_run_at | text | Set when a run starts. |
| last_success_at | text | Set when a run finishes cleanly. The header's "synced N min ago" is the newest of these. |
| last_error | text | Message of the last failure, cut to 500 chars. Cleared on success. |
| config_enc | text | The encrypted credential blob (chapter 4). Null when nothing is set. |
| meta | json | Non-secret state, shallow-merged by patches. Every source gets `lastRun: {at, ms, counts}`. gcal: `calendars[]`, `selectedCalendars[]`, `defaultCalendarId`, `syncTokens{calendarId: token}`, `lastFullSyncAt{}`. todoist: `projects[{id,name}]`, `labels[]`. jobs: `sources[{id,url}]`. A `demo: true` flag marks fixture data. |
| updated_at | text |  |

**courses — your classes this term**

| Column | Type | Meaning |
| --- | --- | --- |
| id | text, pk | Slug: `2026-fall-cmsc422-0101`. Built from term, code, section, lowercased, non-alphanumerics to dashes. |
| term | text | `2026-fall`. Converted to "Fall 2026" when matching Canvas and Gradescope terms. |
| code | text | CMSC422. Uppercased, spaces removed on write. |
| section | text, nullable | 0101. |
| name | text, nullable | Long name. |
| role | text | student or ta. Default student. |
| canvas_course_id | text, nullable, indexed | Canvas's numeric id as text. Auto-filled by the Canvas ingester when exactly one Canvas course matches by code, term, and role; otherwise set by hand. |
| gradescope_course_id | text, nullable, indexed | Same idea for Gradescope. |
| submits_via | text | canvas · gradescope · both. Default both. |
| color | text, nullable | Hex colour used everywhere the course is drawn. Seeded from an 8-colour cycle. |
| links | json | `[{label, url}]` hotlinks shown in widgets and the drawer. |
| schedule | json | `{ lecture: [{day, start, end, location?}], discussion: [...], lab: [...], any_snake_case_kind: [...] }`. day is mon…sun, times are HH:MM local. Kinds are open-ended; four are built in. |
| notes | text, nullable | Free text shown in the drawer overview. |
| archived | integer bool | Archived courses are skipped by ingesters and hidden from widgets. |
| grading | json, nullable | Grade category override (chapter 9). `{mode: 'auto'\|'manual', categories: [{id, name, weight, groupIds[], match, dropLowest}]}`. Null means use Canvas groups. |
| created_at, updated_at | text |  |

#### How courses get into the system

Nothing detects your classes. Courses come from exactly two places. On the very first start, when the courses table is empty, `seed.ts` reads `artifacts/seed-config.json` (its `term` plus a `courses` list with code, section, role, submits_via, optional Canvas and Gradescope ids, links, schedule) and inserts one row per entry with a colour from an 8-colour cycle. That file is never read again once any course exists. After that, Settings → Courses is the only way in: Add course opens a dialog that posts to `POST /api/courses`; Edit does a PUT; Archive keeps the row but hides it.

What *is* automatic is the link to the source. When the Canvas or Gradescope ingester runs, it lists the courses you're enrolled in there and, for each of your rows that has no source id yet, looks for exactly one enrollment with the same code, the same term, and (if that's still ambiguous) the same role. A unique hit writes `canvas_course_id` or `gradescope_course_id` onto the row and that course starts syncing on that run. No hit, or more than one, and the course stays unmatched until you paste the id in the dialog; the run log's `autoFilled` and `matchedCourses` counts tell you which happened.

**items — the unified store; every ingester writes here**

| Column | Type | Meaning |
| --- | --- | --- |
| id | text, pk | `source:externalId`. |
| source | text | canvas · canvas_ical · gradescope · gcal · todoist · manual. Unique together with external_id. |
| external_id | text | The source's id for the thing, e.g. `assignment:7775093`, `primary:abc123`, a Todoist task id, a manual UUID. |
| kind | text, indexed | assignment · event · task · announcement. |
| course_id | text, nullable, indexed | courses.id when the row belongs to a class. Null for Google events, Todoist tasks, and untracked Canvas contexts. |
| title | text |  |
| description | text, nullable | Plain text, HTML stripped, cut to 2000 chars. For manual events this is the note. |
| url | text, nullable | Link into the source. |
| starts_at, ends_at | text, nullable, starts indexed | Events: the span. Assignments: unlock and lock times when Canvas has them. Announcements: posted time in starts_at. Manual all-day events: local midnight to the next midnight. |
| due_at | text, nullable, indexed | Assignments and tasks. All-day Todoist tasks get 23:59 local. |
| all_day | integer bool |  |
| status | text | See chapter 4. Default open. |
| points, score | real, nullable | Points possible and points earned. Both sources fill them when graded. |
| labels | json string[] | Todoist labels. Empty elsewhere. |
| raw | json | Per-source details, listed in chapter 7. Also `demo: true` on fixture rows. |
| first_seen_at | text | Set on insert, kept on update. "Created" counts in run logs come from this. |
| updated_at | text | Touched on every upsert. |
| deleted_at | text, nullable | Soft delete. |

**item_links — a Canvas row and a Gradescope row that are the same assignment**

| Column | Type | Meaning |
| --- | --- | --- |
| a_item_id, b_item_id | text, composite pk, b indexed | The two item ids, always stored sorted so the pair is unique regardless of order. |
| method | text | auto (dedup found it) or manual (you paired them in settings). Auto links are recomputed every run; manual links are never touched. |
| confidence | real, nullable | The similarity score for auto links, 1 for manual. |
| created_at | text |  |

**overrides — your decisions about an item, kept separate from the source's data**

| Column | Type | Meaning |
| --- | --- | --- |
| item_id | text, pk |  |
| hidden | integer bool | Hide from every widget. |
| done | integer bool | "Mark done here only." Never sent to the source. |
| snoozed_until | text, nullable | Hidden until this instant. |
| note | text, nullable |  |
| updated_at | text |  |

**todoist_map — which Todoist task was created for which assignment**

| Column | Type | Meaning |
| --- | --- | --- |
| item_id | text, pk | The assignment. |
| todoist_task_id | text, unique | The task the push created. |
| last_pushed_hash | text, nullable | SHA-1 of title, due, labels, description last sent, so unchanged tasks aren't rewritten. |
| closed_by_us | integer bool | The push (or the to-do widget) closed it. |
| created_at, updated_at | text | This table can be rebuilt: every pushed task carries `collected:<itemId>` in its description. |

**jobs — the internship feed plus manual entries**

| Column | Type | Meaning |
| --- | --- | --- |
| id | text, pk | `simplify:<uuid>` or `manual:<uuid>`. source + external_id unique. |
| source, external_id | text |  |
| company, title | text |  |
| locations | json string[] |  |
| url | text | The posting. Empty string allowed for manual entries. |
| terms | json string[] | e.g. ["Summer 2027"]. |
| sponsorship | text, nullable | Simplify's sponsorship note. |
| degrees | json string[] |  |
| category | text, nullable | Software, AI/ML/Data, Hardware, Product, Quant. |
| posted_at | text, nullable, indexed | For manual entries, when you added it. |
| active, visible | integer bool | Simplify's flags. The feed shows active only by default. |
| matches_filter | integer bool, indexed | Result of your filter (chapter 7). Recomputed when the filter changes. Always false for manual rows. |
| score | real, nullable | Reserved for a future scorer. Unused. |
| first_seen_at, updated_at | text | updated_at moves only when a listing's content changed. |

**job_state — your relationship with a job; the applications tracker**

| Column | Type | Meaning |
| --- | --- | --- |
| job_id | text, pk | A row exists once you've seen, starred, or tracked the job. |
| state | text | The stage list in chapter 4. Default new. |
| notes, resume_path | text, nullable | Free text. |
| seen_at | text, nullable | Set when a card was on screen for two seconds. Drives the "N new" count. |
| applied_at | text YYYY-MM-DD, nullable | Stamped with today the first time state reaches applied, screen, interviewing, or offer, unless you set it. |
| next_action, next_action_at | text, nullable | What's next and by when (a date). |
| updated_at | text | The tracker sorts by this. |

**course_content — per-course material that isn't an item**

| Column | Type | Meaning |
| --- | --- | --- |
| id | text, pk | `courseId:kind:externalId`. course_id + kind + external_id unique. |
| course_id | text, indexed |  |
| kind | text | syllabus · module_item · file · grading · grade_group · grade_summary. |
| external_id | text | Canvas file id, module item id, assignment group id, "syllabus", "summary", Gradescope assignment id. |
| module_name | text, nullable | For module items. |
| title, url | text |  |
| position | integer, nullable | Sort order. Module items use module position × 1000 + item position. |
| raw | json | syllabus: `{html, text}`. module_item: `{type, indent, moduleId, contentId}`, type is File, Page, Assignment, Quiz, ExternalUrl, ExternalTool. file: `{size, contentType, updatedAt}`. grading: `{dueAt, hardDueAt, submissions, gradingProgress, published, openRegradeRequests}`. grade_group: `{weight, rules: {drop_lowest?, drop_highest?, never_drop?}}`. grade_summary: `{currentScore, finalScore, currentGrade, finalGrade, applyWeights}`. |
| updated_at | text | Rows are replaced wholesale per course and kind on each sync. |

**widget_instances, layouts, settings — the dashboard's own state**

| Table · column | Type | Meaning |
| --- | --- | --- |
| widget_instances.id | text, pk | The widget type for singletons (calendar, todo, sources, jobs, classes, tracker, progress, clock, exams, announcements), `class:<courseId>` for per-course class widgets. |
| widget_instances.type | text | Which widget component renders it. |
| widget_instances.config | json | Per-instance options: `{courseId}` for class widgets, `{style, hour24}` for the clock, `{view}` to pin a calendar view. |
| widget_instances.hidden | integer bool | Hidden widgets keep their config and come back from the add tray. |
| widget_instances.created_at | text |  |
| layouts.breakpoint | text, pk | lg (12 columns), md (8), sm (4). |
| layouts.layout | json | `[{i, x, y, w, h, minW?, minH?, maxW?, maxH?}]` where i is a widget instance id and units are grid cells; a row is 40 px. |
| settings.key | text, pk | See chapter 11. |
| settings.value | json | Any JSON. |

Migrations so far: 0000 created everything, 0001 added the Todoist map and course content details, 0002 added applied_at, next_action, next_action_at to job_state, 0003 added grading to courses, 0004 dropped the unused `applications` table (the v1 plan for the tracker before it moved onto `job_state`). Drizzle records applied ones in `__drizzle_migrations`.

## Effective items: the one read path

Widgets never read the `items` table directly. They call `GET /api/items`, which runs `queryEffectiveItems` in `server/src/lib/effective.ts`. It turns stored rows into what the user should see. If you rebuild the backend, this is the logic to get exactly right, in this order:

1. **Select rows** by the query: not soft-deleted (unless includeDeleted), kind in the list, source in the list, course id, and a time window. The window matches a row if its due, end, or start is at or after `from`, and its due or start is at or before `to`. Limit defaults to 2000.
2. **Load the side data** for those ids: overrides, item links, Todoist mappings, all courses, all source rows. For links whose partner is outside the window, load the partner too, done-state only.
3. **Find closed mirrors.** Any Todoist item with status done whose `raw.mirrorOf` names an assignment marks that assignment done. So does a mapped task in the map table that is done.
4. **Is the Canvas cookie source healthy?** Yes if its status is connected and it succeeded in the last two hours.
5. **Walk each row.**
    - Drop canvas_ical rows when Canvas is healthy, and always when a canvas row with the same external id exists. The iCal feed only fills the gap while the cookie is dead.
    - Drop Todoist rows flagged `raw.mirror`; they're the pushed copies of assignments, and showing them would duplicate the assignment.
    - If the row has a link and the caller didn't ask for noCollapse: keep only the preferred side. Preferred is gradescope when the course's submits_via is gradescope, canvas otherwise. The other side's id goes into `linkedIds`.
    - `effectiveDone` = the row's own status is submitted, done, late, or graded; or an override says done; or a mirror closed it; or any linked partner is done by the same test.
    - `effectiveHidden` = override hidden, or snoozed until a future time.
    - `informational` = `raw.ta` is true (a TA course), or the row is from Gradescope in a course whose submits_via is canvas.
    - Then filter: informational rows out unless includeInformational; done out unless includeDone; hidden out unless includeHidden.
6. **Attach the course** as `{id, code, color, role}` and sort by due, then start, ascending.

The response shape, `EffectiveItem`, is every item column plus `effectiveDone`, `effectiveHidden`, `informational`, `linkedIds`, `override` (the row or null), and `course`.

> **Why this design.** The store keeps exactly what each source said. Your opinions (done here only, hide, snooze) live in a separate table. Duplicate detection is a separate table too. Because they're separate, a re-sync can never wipe your decisions, and any of the three can be recomputed or reset without touching the others.

## Sources and ingesters

### What every ingester has in common

Each one is an object with an id, an interval in minutes, a timeout, and a `run(ctx, signal)` function returning counts and an optional patch for `sources.meta`. The runner (`ingest/runner.ts`) wraps every run:

- Skips if that source is already running, or disabled (unless forced from settings or the CLI).
- Writes `last_run_at`, starts a timeout that aborts the network calls, and calls run.
- On success: status connected, `last_success_at`, `last_error` cleared, counts merged into `meta.lastRun`. Then after-hooks: for canvas and gradescope, run dedup and, if enabled, the Todoist push.
- On a NotConfigured error: status disconnected, no error text, nothing logged loudly. On a NeedsAuth or undecryptable-config error: status needs_auth with the message. Anything else: status error with the message.

The scheduler (`scheduler.ts`) makes one cron job per ingester with a small minute offset so they don't all fire together, and runs every ingester once five seconds after the server starts so a fresh deploy isn't empty. The runner's mutex prevents overlap if a run outlives its interval.

Two helpers do all the writing. `upsertItems(source, rows, scope)` inserts each row or updates it on id conflict (all content columns, updated_at, and clears deleted_at), counts a row as created when first_seen_at equals this run's timestamp, then soft-deletes every row of that source matching `scope` that wasn't in this batch. `replaceCourseContent(courseId, kinds, rows)` upserts the rows and hard-deletes any other row of those kinds for that course.

### Canvas (every 15 min · timeout 240 s)

**Auth.** Your browser's Canvas session cookie. It gets in two ways: pasted into Settings as a cookie header, or pushed by the Mac helper script. The server keeps it in a serialized cookie jar inside the encrypted config, sends it on every request through fetch-cookie, and re-saves the jar after every run because Canvas rotates the session cookie and the expiry only slides if the newest value is kept. A response that redirects to `/login`, returns 401 or 403, or returns HTML instead of JSON throws NeedsAuth.

**Calls, in order,** all against `https://umd.instructure.com` with `Accept: application/json+canvas-string-ids` so ids come back as strings. Every list follows the `Link: rel=next` header for pagination and pauses when the rate-limit header drops under 100. Canvas prefixes JSON with `while(1);`, which is stripped.

| Call | Used for |
| --- | --- |
| GET /api/v1/courses?enrollment_state=active&include[]=term&include[]=total_scores | Your enrollments. Matched to your courses by explicit canvas_course_id, else by normalised code equal to the course_code (or name starting with it), term label equal, and role agreeing if still ambiguous. A unique match auto-fills the id. Also supplies the enrollment's computed grade and whether the course applies group weights. |
| GET /api/v1/courses/:id/assignments?include[]=submissionℴ_by=due_at | Per matched course. Unpublished ones skipped. Each becomes an item: status from the submission (excused → done, missing → missing, graded → graded or late, submitted/pending_review → submitted or late, else open; TA courses always open). Description HTML stripped. |
| GET /api/v1/planner/items?start_date&end_date | 14 days back to 60 ahead. Adds calendar events (kind event), announcements, planner notes (kind task), and overlays assignments: a planner override marked complete makes the assignment done; missing flags apply when the assignment row said open. |
| GET /api/v1/announcements?context_codes[]=course_<id>&start_date&end_date | 30 days back, 7 ahead, for matched courses. Planner only shows unread ones. |
| GET /api/v1/courses/:id?include[]=syllabus_body | Syllabus HTML and stripped text → course_content syllabus. |
| GET /api/v1/courses/:id/modules?include[]=items | Module items (published, not SubHeader) → course_content module_item. |
| GET /api/v1/courses/:id/files?sort=updated_atℴ=desc&per_page=30 | The 30 most recent visible files → course_content file. |
| GET /api/v1/courses/:id/assignment_groups | Student courses only. Groups with weight and drop rules → course_content grade_group. The enrollment's totals → grade_summary. |
| GET /api/v1/files/:id/public_url | Not in the sync; used by the file-open route (chapter 10). |

**Upsert scope:** assignments in tracked courses. Events and announcements are left to age out. **raw keys on assignments:** ta, canvasCourseId, submissionTypes, isQuiz, quizId, needsGradingCount, published, submittedAt, late, updatedAt, groupId, omitFromFinal, gradingType, excused, grade, plannerOverride. Events: plannerType, location, contextName. Announcements: contextCode.

### Canvas iCal (every 60 min · timeout 60 s)

The fallback. Config is one URL, your personal Canvas calendar feed. It downloads the .ics, parses it with node-ical, and maps VEVENTs whose UID starts with `event-assignment-` to assignments and the rest to events, matching the course from the bracketed course name at the end of the summary. There's no submission state, which is why chapter 6 hides these rows whenever the cookie source is healthy. Source id canvas_ical; no soft-delete scope.

### Gradescope (every 30 min · timeout 180 s)

**Auth.** Gradescope has no API. Config is your native email and password (not the school SSO). The client fetches pages with a cookie jar; when a page lands on the login form it GETs `/login`, copies every hidden input from the form (the CSRF token among them), posts email, password, and remember-me, and retries. A second landing on login, or "Invalid email/password", throws NeedsAuth. The jar is saved after each run so logins are rare.

**Pages parsed** with cheerio, fixtures in the repo: `/account` lists courses with id, shortname, name, term, and whether you're an instructor, matched like Canvas. A student course page `/courses/:id` is a server-rendered table with title, release, due, late due, a status cell, and score/points. Statuses map: graded, late, submitted, no submission past due → missing, else open. An instructor page `/courses/:id/assignments` renders its table with React, but the data is embedded as JSON in a `data-react-props` attribute, so plain HTTP still works: each becomes an informational item (`raw.ta`) and a course_content grading row with submissions, grading progress, published, and regrade counts.

raw keys: gradescopeCourseId, statusText, lateDueAt; TA rows add ta, gradingProgress, numActiveSubmissions, isPublished, openRegradeRequests. Upsert scope: assignments in matched courses.

### Google Calendar (every 5 min · timeout 120 s)

**Auth.** OAuth through two routes. `GET /api/google/start` makes a random state, remembers it for ten minutes, and redirects to Google's consent page asking for calendar.events and calendar.readonly with offline access. Google sends the browser back to `GET /api/google/callback?code&state`; the server checks the state, trades the code for tokens, stores the refresh token encrypted, lists calendars, selects the primary, and starts a sync. Both routes are browser navigations, so Access covers them in production. The redirect URI is `PUBLIC_URL/api/google/callback`, which must be registered in the Google Cloud console.

**Sync.** For each selected calendar in `meta.selectedCalendars`: if a sync token is stored, list events with it (Google returns only what changed); otherwise a full window, 30 days back to 90 ahead, with `singleEvents=true` so recurrences arrive expanded, and `showDeleted=true`. A 410 response means the token expired; fall back to a full window. Every page's `nextSyncToken` is stored for next time. Events map to items of kind event: all-day dates become local midnight, cancelled ones are soft-deleted with status cancelled, tentative stays open. Full syncs soft-delete events in the window the calendar no longer returns; incremental ones don't. Deselected calendars have their rows retired and tokens dropped. raw keys: calendarId, calendarName, color, location, recurringEventId, tentative, updated. Refresh-token rejection (invalid_grant) throws NeedsAuth; that's what a Google app left in testing mode causes after seven days.

### Todoist (every 5 min · timeout 120 s)

**Auth.** A personal API token in the Authorization header against `https://api.todoist.com/api/v1`. 401 or 403 throws NeedsAuth; 429 waits for retry-after and tries again. Lists are cursor-paginated under a `results` key.

**Sync.** Projects, sections, labels, all open tasks, and tasks completed in the last 30 days (`/tasks/completed/by_completion_date`, which wants plain second-precision timestamps). Every task becomes an item of kind task: due is `YYYY-MM-DD` for all-day (stored as 23:59 local) or a floating local time resolved with the task's timezone; status done when checked or completed; url deep-links into the Todoist app. A task whose description contains `collected:<itemId>` is a mirror our push created, flagged `raw.mirror` and `raw.mirrorOf`. Open tasks are authoritative, so no soft-delete scope is passed: anything we stop seeing was completed or deleted. raw keys: projectId, parentId, projectName, sectionId, sectionName, priority, recurring, dueString, completedAt, mirror, mirrorOf. The run's meta patch stores projects and label names for the settings page.

### Jobs (every 60 min · timeout 180 s)

No credentials. It downloads SimplifyJobs' `listings.json` from GitHub raw (the file behind their README), about 16,000 entries across seasons. Your filter, the `jobs.filter` setting, is compiled once per run: require active, require visible, categories, terms, a title-include regex, a title-exclude regex, location include and exclude regexes, all case-insensitive; a broken regex is reported and ignored. For each listing it computes `matches_filter` and a fingerprint of every content column, loads the stored fingerprints for the source, and writes only new or changed rows in one transaction, plus a job_state row for anything new. A run with no changes writes nothing. Before this diff existed, each run rewrote 16k rows with an fsync apiece and took up to 17 minutes on the deployment box; that history is in DECISIONS 024.

## Dedup and the Todoist push

### Dedup: the same homework in Canvas and Gradescope

Many courses post an assignment in Canvas and collect it in Gradescope, so both ingesters produce a row. `sync/dedup.ts` runs after each of those syncs and per course:

1. Skip courses with submits_via canvas entirely; their Gradescope rows are informational and never linked.
2. Normalise both titles: lowercase, remove the course code, unify hw/homework/assignment to "hw", ps/pset to "ps", proj to "project", strip punctuation, drop leading zeros in numbers.
3. Score every Canvas × Gradescope pair by Sørensen-Dice similarity over character bigrams, minus 0.35 if the numbers in the titles differ, minus 0.5 if due dates are more than 24 hours apart, plus 0.1 if within an hour.
4. Keep pairs scoring at least 0.6, greedily best-first, each row used once.
5. Delete auto links that no longer appear in the wanted set; insert wanted pairs as auto links with the score as confidence, unless either row already has a manual link, which always wins.

The settings drawer shows the pairs per course and lets you unlink or hand-pair, which writes method manual.

### The Todoist push: one-way, closes only

Off by default (`todoist.push.enabled`). When on, after every Canvas or Gradescope sync, and on demand from settings, the push makes Todoist mirror your assignments. Rules, from DESIGN.md, that the code enforces:

- One task per effective assignment that isn't informational, isn't from the iCal fallback, and is due between 30 days ago and 120 days ahead.
- The task's description ends with `collected:<itemId>`. That marker lets the map table be rebuilt from Todoist alone if the database were lost.
- Title, due date, and labels come from the source. Labels are the common label (default "homework") plus the course code lowercased when enabled.
- Done at the source closes the task. Nothing ever reopens a task.
- A task you deleted in Todoist is left alone, never recreated.
- An assignment that vanished at the source (soft-deleted) deletes its still-open task.
- Already-done assignments with no task are skipped; the push never creates a task just to close it.

`planPush` reads Todoist (projects, open tasks in the project, 90 days of completed tasks) and the effective items, rebuilds any missing mappings from markers, and emits a list of create, update, close, delete operations with reasons. Updates are only emitted when the task's content, due, or labels differ and the hash of what we'd send differs from the last pushed hash. `executePush` creates the project and any missing labels first, applies the operations one at a time recording each in the map, and collects errors without stopping. Preview in settings is the plan without execution.

The reverse direction is deliberately tiny: closing a task from the to-do widget calls Todoist's close endpoint, marks the local item done, and if the task was a mirror, writes a done override on the assignment so it disappears immediately. Nothing ever writes to Canvas or Gradescope.

## Grades

Nothing about grades is stored beyond what the ingester copies. `lib/grades.ts` recomputes on request, from three inputs: the course's grade_group rows (Canvas assignment groups with weights and drop rules), its grade_summary row (Canvas's own current score and whether it applies weights), and the course's effective assignments with score and points, loaded with done and informational included. For a linked Canvas + Gradescope pair the collapsed row keeps whichever side's group id and score exists.

**Categories** come from the course's `grading` column when mode is manual: each has a name, weight or null, Canvas group ids it absorbs, an optional case-insensitive regex on titles, and a drop-lowest count. Otherwise one category per Canvas group with that group's weight and drop rule. **Weighted** is true in manual mode when any category has a weight, and in auto mode only when Canvas says it applies weights and groups carry weights.

**Per category:** an assignment counts once it has a score, isn't excused, isn't omitted from the final grade, and has positive points possible. Drop the lowest N by score-over-points. Sum the rest: earned over possible is the percent. **Overall:** if weighted, the weight-averaged percent over categories that have graded work, which is how Canvas's "current score" behaves; otherwise total points earned over total possible across everything, including uncategorised work. Both numbers are returned, along with Canvas's own so a disagreement is visible.

`GET /api/grades` runs this for every non-archived student course, which is a handful of queries per course; fine at this scale, worth a cache if courses multiplied.

## API reference

All routes live under `/api`, take and return JSON, and require a valid Cloudflare Access JWT unless `AUTH_DISABLED` is on. The JWT arrives as the `cf-access-jwt-assertion` header or the `CF_Authorization` cookie and is verified against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with the configured audience. Two routes are exempt, marked (open). Query parameters that take lists are comma-separated. Boolean query flags accept `1` or `true`.

Shapes named below (Source, Course, EffectiveItem, Job, CourseGrades, WidgetInstance, Layouts) are the TypeScript interfaces in `shared/src/types.ts`; request bodies are validated by the zod schemas in `shared/src/schemas.ts`, and 422 responses list the failing fields.

### Health

#### GET `/api/health`  _(open)_

Returns `{ok: true, version, now, authDisabled}`. Docker's container health check calls this from inside the container, which is why it needs no JWT.

### Sources

#### GET `/api/sources`

Every ingested source as `Source[]`: id, enabled, status, lastRunAt, lastSuccessAt, lastError, hasConfig (never the config itself), running (a sync is in flight in this process right now), meta, updatedAt. Ordered canvas, canvas_ical, gradescope, gcal, todoist, jobs.

#### GET `/api/sources/:id`

One source. 404 for an unknown id.

#### PUT `/api/sources/:id/config`

- **Body:** Per source. canvas: `{baseUrl?, cookieHeader?, cookieJar?}`. canvas_ical: `{url}`. gradescope: `{email, password}`. gcal: `{refreshToken}`. todoist: `{token}`. jobs: `{sources: [{id, url}]}`.
- **Effect:** Encrypts and stores the whole body, sets status disconnected and enabled true. The next run decides connected or needs_auth.
- **Returns:** Source.

#### DELETE `/api/sources/:id/config`

Clears the credential, status disconnected. Returns Source.

#### PUT `/api/sources/:id/enabled`

- **Body:** `{enabled: boolean}`
- **Returns:** Source.

#### PATCH `/api/sources/:id/meta`

- **Body:** Any object; shallow-merged into meta. The web app uses it for selected Google calendars and the default calendar.
- **Returns:** Source.

#### GET `/api/sources/:id/summary`

The settings "data pulled" panel: `{id, status, lastError, lastRun, byCourse: [{courseId, code, role, linkedId, kinds: {kind: count}, content: {kind: count}}], unassigned: {kind: count}, recent: [30 most recently updated items, trimmed], jobs: {total, matched} | null, total}`.

#### POST `/api/sources/sync`

The header's sync button. Starts every enabled source that isn't already running and answers 202 immediately with `{started: [ids], skipped: [{id, reason: 'running'|'disabled'}]}`; the runs continue in the background. The web app then polls `GET /api/sources` every two seconds until none of the started ids report `running`, refetches everything, and toasts a summary. Unconfigured sources start and end as disconnected a moment later.

#### POST `/api/sources/:id/sync`

Runs the ingester now, ignoring the enabled flag. Returns `{outcome, source}` where outcome is `{ok: true, result, ms}`, `{ok: false, skipped: 'running'|'disabled'}`, or `{ok: false, error, status, ms}`.

#### POST `/api/sources/canvas/cookie`  _(open, helper key)_

- **Auth:** Either the Access JWT or the header `x-collected-key` equal to `LOCAL_HELPER_KEY`, compared in constant time. This is how the Mac script delivers the cookie.
- **Body:** `{cookieHeader: "name=value; name2=value2", baseUrl?}`, at least 10 characters.
- **Effect:** Replaces the Canvas config (dropping any old jar), enables the source, runs a sync immediately.
- **Returns:** `{ok: true, outcome}`.

### Courses

#### GET `/api/courses`

`Course[]`, archived last then by code. Every column of the table.

#### POST `/api/courses`

- **Body:** `{term, code, section?, name?, role?, canvasCourseId?, gradescopeCourseId?, submitsVia?, color?, links?, schedule?, notes?, archived?, grading?}`. term and code required; code is uppercased and de-spaced; links must be `{label, url}` with a valid URL; schedule keys must be lowercase snake_case with HH:MM times.
- **Effect:** Creates the course under its slug and a hidden class widget instance `class:<id>`.
- **Returns:** 201 Course. 409 if the slug exists.

#### GET `/api/courses/:id`

One course or 404.

#### PUT `/api/courses/:id`

Body is any subset of the create body. Returns the updated Course. The grades editor saves `{grading}` through this.

#### DELETE `/api/courses/:id`

Deletes the course, its class widget instance, and its course content. Items keep their course_id (now dangling) and stay.

#### GET `/api/courses/:id/links`

For the settings pairing UI: `{canvas: [{id, title, dueAt, status, url}], gradescope: [...], links: [{a, b, method, confidence}]}`.

#### GET `/api/courses/:id/content`

Every course_content row for the course, ordered by kind then position.

### Items

#### GET `/api/items`

- **Query:** `from`, `to` (ISO), `kind` (list of assignment, event, task, announcement), `source` (list), `course` (course id), `includeDone`, `includeHidden`, `includeInformational`, `noCollapse`, `limit`.
- **Returns:** `EffectiveItem[]` per chapter 6, sorted by due then start.

#### POST `/api/items/:id/override`

- **Body:** `{hidden?, done?, snoozedUntil?, note?}`. Merged into the override row.
- **Returns:** The override row. 404 if the item doesn't exist.

#### POST `/api/items/link` · POST `/api/items/unlink`

Body `{a, b}`, two item ids. Link writes a manual link with confidence 1 (replacing an auto one). Unlink removes the pair either way round.

#### POST `/api/items/manual`

- **Body:** `{courseId?, kind, title, date: YYYY-MM-DD, start?: HH:MM, end?: HH:MM, location?, note?, meetingKind?}`. kind is exam, quiz, final, cancelled, virtual, other. end needs start and must be after it. meetingKind names the scheduled session a cancelled or virtual tag applies to.
- **Effect:** Creates an items row: source manual, kind event, id `manual:<uuid>`, all-day when no start, raw `{eventKind, date, start, end, location, note, meetingKind}`.
- **Returns:** 201, the raw items row.

#### PUT `/api/items/manual/:externalId` · DELETE `/api/items/manual/:externalId`

Same body as create for PUT; replaces every field. DELETE hard-deletes the row and its override. 404 unless the row exists and is source manual.

### Jobs

#### GET `/api/jobs`

- **Query:** `state` (list of stages), `matchesOnly` (default on; pass 0 for everything), `active` (default on; pass 0 to include inactive), `includeHidden`, `since` (posted at or after), `limit` (default 200, max 1000).
- **Returns:** `Job[]`: every jobs column plus state, notes, seenAt, appliedAt, nextAction, nextActionAt, resumePath, stateUpdatedAt. Manual entries are never in the feed. Hidden ones are excluded unless a state list or includeHidden is given.

#### GET `/api/jobs/stats`

`{total, active, matched, unseen, tracked}`. unseen is matched, active, never seen, not hidden. tracked counts job_state rows in a tracked stage, manual included.

#### GET `/api/jobs/tracked`

`Job[]` with any stage other than new or hidden, feed and manual alike, most recently updated first.

#### PATCH `/api/jobs/seen`

Body `{ids: string[]}`, 1 to 500. Sets seen_at now where it was null.

#### POST `/api/jobs/recompute`

Re-evaluates matches_filter for every feed row against the current filter setting. Returns `{total, matched}`. The settings page calls it after saving the filter.

#### POST `/api/jobs`

- **Body:** `{company, title, url?, locations?, state?, appliedAt?, notes?}`. state defaults to applied.
- **Effect:** Inserts a manual jobs row and its job_state in one transaction, stamping applied_at with today when the state is applied or later and none was given.
- **Returns:** 201 Job.

#### GET `/api/jobs/:id`

One Job or 404.

#### DELETE `/api/jobs/:id`

Manual entries only; feed rows return 400 with the advice to hide instead, because the next sync would recreate them.

#### PATCH `/api/jobs/:id/state`

- **Body:** `{state?, notes?, appliedAt?, nextAction?, nextActionAt?, resumePath?}`. Dates are YYYY-MM-DD.
- **Effect:** Upserts job_state. Moving into applied, screen, interviewing, or offer stamps applied_at with today if it's empty and the body didn't set it.
- **Returns:** Job.

### Grades

#### GET `/api/grades`

Per non-archived student course: `{courseId: {current, weighted, graded, total, canvasCurrent}}`.

#### GET `/api/grades/:courseId`

`CourseGrades`: courseId, mode, weighted, current, unweighted, canvas (the summary or null), categories (each with id, name, weight, earned, possible, percent, graded, total, dropLowest, and its assignments with score, points, dropped, excused, omitFromFinal), uncategorized, graded, total.

### Layout and widgets

#### GET `/api/layout`

`{lg?: LayoutItem[], md?: [...], sm?: [...]}`.

#### PUT `/api/layout`

Same shape. Each breakpoint present is replaced; missing ones untouched. Returns `{ok: true}`.

#### DELETE `/api/layout`

Removes all saved layouts; the web app falls back to defaults.

#### GET `/api/widgets`

`WidgetInstance[]`: id, type, config, hidden, createdAt.

#### PUT `/api/widgets/:id`

Body `{type?, config?, hidden?}`. Updates an existing instance or creates one (type required then, 422 otherwise). Returns the instance.

#### DELETE `/api/widgets/:id`

Removes the instance.

### Settings

#### GET `/api/settings` · GET `/api/settings/:key`

All settings as one object, or one value (404 if unset).

#### PUT `/api/settings/:key`

The body is the value itself. Known keys (chapter 11) are validated; any other key stores whatever JSON is sent. Returns the stored value.

### Google, calendar, Todoist, Canvas files

#### GET `/api/google/start` · GET `/api/google/callback`

The OAuth flow from chapter 7. Both end with a redirect to `PUBLIC_URL/settings/sources?google=connected|error|unconfigured&reason=…`.

#### POST `/api/calendar/events`

- **Body:** `{title, allDay?, start, end?, calendarId?, description?, location?}`. start is YYYY-MM-DD for all-day, ISO otherwise; end defaults to the next day or one hour later.
- **Effect:** Creates the event in Google on the given, default, or primary calendar, then upserts the resulting item locally so it shows before the next sync.
- **Returns:** 201, the item row. 409 when no calendar is selected.

#### POST `/api/todoist/push`

- **Query:** `dryRun=1` returns `{plan}` only. `force=1` executes even when the setting is disabled.
- **Returns:** `{plan, done: {create, update, close, delete}, errors, projectId}`. Saves the project id into the setting and re-syncs Todoist afterwards. 409 if disabled and not forced.

#### GET `/api/todoist/config` · PUT `/api/todoist/config`

The `todoist.push` setting with defaults applied; PUT merges a partial body.

#### POST `/api/todoist/tasks/:id/close`

Closes the task in Todoist, marks the local item done, and if the task was a pushed mirror, writes a done override on the assignment. Returns `{ok: true}`.

#### POST `/api/todoist/tasks/quick`

Body `{text}`, up to 500 characters, sent to Todoist's natural-language quick add ("tomorrow 5pm @grocery #Home"). The created task is upserted locally. Returns 201, the item row.

#### GET `/api/canvas/files/:id/open`

- **Query:** `download=1` to force a download.
- **Effect:** Asks Canvas for the file's public_url with the stored session and answers 302 to it. That link is single-use and points at Canvas's CDN, which serves inline, so the browser renders PDFs and no bytes pass through the server. Cache-Control no-store. 404 if Canvas isn't connected or the file is gone, 502 with a reconnect hint if the session is dead (and the source is marked needs_auth).

### Export, import, demo

#### GET `/api/export`

`{version: 1, exportedAt, courses, settings, widgets, layouts}`. Everything you authored and nothing secret; no items, no credentials.

#### POST `/api/import`

The same shape. Upserts courses by id or slug (and their class widgets), settings by key, widgets, and layouts. Returns counts.

#### DELETE `/api/demo`

Removes rows the fixture loaders created (tagged `raw.demo`, known fixture ids, demo calendars) and strips demo flags from Google and Todoist meta. Real syncs recreate anything genuinely there.

## Settings keys and the CLI

| Key | Shape | Used by |
| --- | --- | --- |
| jobs.filter | `{require_active, require_visible, categories_include[], terms_include[], title_include, title_exclude, locations_include, locations_exclude, sponsorship: 'ignore'\|'require_none_needed'}` | The jobs ingester and recompute. Seeded from seed-config.json. |
| todoist.push | `{enabled, projectId, projectName: 'School', commonLabel: 'homework', courseLabels: true}` | The push. |
| todo.sections | `string[]` of labels in display order | The to-do widget's tabs. Default `["homework"]`. |
| timezone | string | Reserved; the process uses TZ. |
| profile.initials | string (stored as given, not validated) | The header avatar. |

### The CLI

`pnpm cli <command>` runs the same bootstrap as the server against the same database, then exits. Everything an ingester does, you can trigger and watch by hand, which is how each one was built.

- `seed` — Re-run seeding. Idempotent.
- `sync <source|all>` — Run an ingester now, ignoring enabled. Prints the outcome JSON. Also `pnpm sync canvas`.
- `export · import <file>` — The config round-trip from chapter 10.
- `demo canvas|gradescope|gcal|todoist` — Load the repo's fixtures through the real sync code, tagged so `demo clear` can remove them. UI development without live credentials.
- `push [--dry-run]` — The Todoist push, ignoring enabled.
- `dedup` — Recompute auto links.

## The web app

Vite builds it; React 19 renders it; Tailwind v4 and shadcn components (over Radix primitives) style it; TanStack Query fetches and caches; react-router has two routes; react-grid-layout does the dragging. In development Vite serves it on port 5173 and proxies `/api` to the server on 3000. In production the server serves the built files.

### How data reaches a widget

`web/src/lib/api.ts` is a fifteen-line fetch wrapper: prefix `/api`, send JSON, throw an error carrying the server's message. `web/src/lib/queries.ts` is the only file that knows endpoint paths. For every read there's a hook (`useItems`, `useJobs`, `useCourseGrades`, …) whose query key includes its parameters; reads poll every 60 seconds while the tab is visible and refetch when it regains focus. For every write there's a mutation hook that invalidates the affected query keys, so the UI refreshes without page reloads. Layout and widget saves update the cache optimistically. This file plus `shared/` is the entire contract with the server; a rewrite that keeps those paths and shapes needs no web changes.

### The dashboard

- **Dashboard.tsx** renders the header (date, a summary line computed from courses, overdue items, and source sync times, then Edit layout, a sync-all button, theme, avatar menu) and the grid. The sync button posts to `/sources/sync`, spins while any started source still reports running, then invalidates every query.
- **useLayout.ts** loads widget instances and saved layouts, reconciles them with `defaults.ts` so every visible widget has a slot at every breakpoint, and debounces saves by half a second. Persisting only happens on user-driven changes.
- **Grid.tsx** wraps react-grid-layout: 12/8/4 columns at 1100/700/0 px, 40 px rows, 8 px gaps, dragging only from the title bar and only in edit mode.
- **WidgetFrame.tsx** is the card around every widget: a tinted surface, a header with the title and a slot, an edit-mode grip and hide button, and a body measured by a ResizeObserver. `useWidgetSize` turns the body's width and height into a tier (xs under 300 px, sm under 520, md under 820, lg) and an aspect (tall, square, wide); widgets switch layouts on those rather than media queries. `WidgetHeader` lets a widget render controls into the frame's header through a portal.
- **registry.ts** is the list of widget types. Each entry has a type, name, accent colour, sources it requires (a placeholder renders if one is disconnected), size presets for the add tray, minimums, an optional multi-instance flag, and the component. Adding a widget is a folder and an entry.
- **EditMode.tsx** holds the edit flag; `e` toggles it, Escape leaves it.

| Widget | Reads | Does |
| --- | --- | --- |
| calendar | items in the visible range, done included for week and month | Next, agenda, days, week grid, month, auto-picked by size; quick-add posts to /calendar/events. |
| todo | assignments and tasks due within 60 days, undated tasks, settings, sources | Sections by label, subtasks nested, circular checks (override or Todoist close), quick add. |
| sources | /sources | Live, standby, attention dots; sync-now per row. |
| classes | courses, assignments 3 weeks out, manual events, /grades | Grade ring, next due, opens the course drawer. |
| class (per course) | the course's items and content | Up next, grading queue for TA, announcements, files. |
| jobs | /jobs with matchesOnly, /jobs/stats | Tape or grid of cards; star, applied, hide; marks cards seen after two seconds on screen. |
| tracker | /jobs/tracked | Board by stage or list; add manual entries. |
| progress | assignments and tasks due in the week or month | Nested completion rings per course. |
| clock | courses and manual events | Analog or digital, next scheduled session. |
| exams | manual exam/quiz/final events, exam-titled assignments | Countdown tiles. |
| announcements | announcements across courses | Newest first; read state in localStorage. |

### Drawer, popovers, settings

`panes/PaneContext.tsx` owns one right-hand sheet for the whole app and a file-preview dialog; anything calls `usePane().open({kind: 'course'|'job'|'job-new'})`. `CoursePane` is the whole course in tabs (overview, assignments, grades, dates, files, announcements, syllabus), `JobPane` is one job with the tracker fields saving on blur, `FilePreview` frames a Canvas file. `ItemPopover` is the detail card any item opens into, with mark-done and open-in-source. Settings pages, under `/settings/*`: sources (a card per source with its credential form and a data viewer), courses (table plus a dialog with the schedule grid editor and assignment pairing), Todoist sync, jobs filter, layout (reset, initials), export and import.

### Theme

`styles.css` defines the palette as named tokens, light on `:root` and dark on `.dark`, and aliases the shadcn variable names to them. `lib/theme.tsx` stores system, light, or dark in localStorage and toggles the class; a script in `index.html` applies it before React loads so there's no flash. A web manifest and icons make it installable on a phone.

## Building, running, deploying

### Development on the Mac

`pnpm dev` starts two processes: the server through tsx in watch mode on port 3000, restarting on file changes and applying migrations on each restart, and Vite on 5173 with the proxy. `.env` at the repo root sets `AUTH_DISABLED=true` so there's no login wall locally. The database is `./data/collected.db`. `pnpm -r typecheck` and `pnpm -r test` cover both packages; tests run against an in-memory SQLite with the real migrations and never touch a live service.

### Environment variables

| Variable | Meaning |
| --- | --- |
| PORT | 3000. |
| DATA_DIR | Where the database and key file live. `./data` locally, `/data` in the container. Relative paths resolve from the repo root. |
| SECRET_KEY | 32 bytes as hex, or empty to use `DATA_DIR/.secret_key`. Recommended empty. |
| AUTH_DISABLED | true only for local development. When false, the next two are required. |
| CF_ACCESS_TEAM_DOMAIN · CF_ACCESS_AUD | Your Access team domain (`<team>.cloudflareaccess.com`) and the application's audience tag. Used to verify JWTs. |
| LOCAL_HELPER_KEY | Shared secret the cookie helper sends. |
| GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET | The OAuth client from Google Cloud. |
| PUBLIC_URL | Where the browser reaches the app. Builds the OAuth redirect URI and settings redirects. `http://localhost:5173` in dev, the public hostname in prod. |
| SCHEDULER_DISABLED | Run the API without timers. |
| SEED_CONFIG_PATH · WEB_DIST · MIGRATIONS_DIR | Overrides for where the seed file, built web app, and migrations are. The Dockerfile sets the first two. |
| TZ · LOG_LEVEL | America/New_York; pino level, info by default. |

### The build

`vite build` turns `web/src` into static files in `web/dist`. `tsup` bundles `server/src/index.ts` and `cli.ts` into `server/dist`, inlining the shared package and leaving npm dependencies external. `pnpm --filter server --prod deploy /out/server` then copies the server package with only its production dependencies into one self-contained folder, migrations included.

### The Docker image

The Dockerfile does that build inside a container in stages, so a change to one side reuses the other's cached layer:

1. **base**: `node:24-bookworm-slim` with pnpm installed.
2. **deps**: copies only the lockfile and the three package.json files and installs, with pnpm's store mounted as a build cache.
3. **build-web**: copies shared and web, runs `vite build`. Type-checking is skipped on purpose; do it before building.
4. **build-server**: copies shared and server, runs tsup and the prod deploy.
5. **runtime**: a fresh node image with the deployed server at `/app/server`, the web files at `/app/web/dist`, and the seed config; sets `NODE_ENV=production`, `DATA_DIR=/data`, `WEB_DIST`, `SEED_CONFIG_PATH`; runs as the unprivileged `node` user; declares `/data` a volume; a HEALTHCHECK curls `/api/health` every 30 seconds with a 5-second timeout; the command is `node dist/index.js`.

### Compose

`docker-compose.yml` describes one service, `app`: build from the Dockerfile but use the image tag `collected:latest` (so a loaded image is used instead of rebuilding), restart unless stopped, publish port 3000 on 127.0.0.1 only, bind-mount `./data` to `/data`, read `.env`, and set DATA_DIR, TZ, PUBLIC_URL, and `NODE_OPTIONS=--max-old-space-size=384` so a large feed parse garbage-collects instead of swapping on a 1 GB machine. Because the data directory is a bind mount, the host folder must be owned by uid 1000 or the container can't create its key file.

### The box

A Google Cloud e2-micro in us-east1, the Always Free tier: a quarter of a shared vCPU sustained, 1 GB RAM plus a 2 GB swap file, a 30 GB standard disk that manages roughly 45 write operations a second. Ubuntu 24.04 with Docker. The repo is cloned to `/srv/collected` with a read-only deploy key; that checkout supplies the compose file, `.env`, and the `data` directory. The database, its WAL and shm sidecars, and `.secret_key` are all in `data`; back that folder up and you have everything. The box cannot build the image: the Vite build needs more memory than it has and swaps it into unresponsiveness.

### Cloudflare Tunnel and Access

Nothing on the box listens on a public port. A `cloudflared` systemd service, installed with a tunnel token from the Cloudflare dashboard, keeps outbound QUIC connections open to Cloudflare's edge. The tunnel's public hostname rule maps `collected.priyamkabra.com` to `http://localhost:3000`, and Cloudflare created the DNS record. In front of that, an Access application for the hostname with a policy allowing one email; login is a one-time PIN or Google. A request flows browser → Cloudflare (TLS terminates, Access checks the session, attaches the JWT) → tunnel → cloudflared → localhost:3000 → the server, which verifies the JWT. The connector proves the box is yours with the token; Access proves the visitor is you.

### Deploying a change

Pushing to `main` deploys. `.github/workflows/deploy.yml` runs on a GitHub-hosted runner: `pnpm -r typecheck` and `pnpm -r test` as the gate, then the Docker build (native amd64, layer cache in GitHub's cache store), `docker save | gzip`, `scp` to the box, and over SSH: `git pull --ff-only`, retag the running image as `collected:prev`, `docker load`, `docker compose up -d`, then poll `/api/health` from inside the box for up to three minutes. One deploy runs at a time; a second push queues. The runner authenticates with a dedicated SSH key (repo secret `DEPLOY_SSH_KEY`; public half in the instance's `ssh-keys` metadata) against `DEPLOY_HOST` / `DEPLOY_USER` repo variables, with the box's host key pinned in the workflow. Rollback on the box: `docker tag collected:prev collected:latest && docker compose up -d`. The box's IP is ephemeral; if the instance is ever stopped and started, update `DEPLOY_HOST`.

The same steps by hand, if Actions is unavailable:

```
# on the Mac, main checked out, Docker Desktop running
pnpm -r typecheck
docker build --platform linux/amd64 -t collected:latest .
docker save collected:latest | gzip -1 > /tmp/collected.tar.gz        # ~110 MB
gcloud compute scp /tmp/collected.tar.gz collected-instance-2:/tmp/ --zone us-east1-c
gcloud compute ssh collected-instance-2 --zone us-east1-c --command \
  'cd /srv/collected && git pull --ff-only && gunzip -c /tmp/collected.tar.gz | docker load && docker compose up -d'
# verify after a couple of minutes
gcloud compute ssh collected-instance-2 --zone us-east1-c --command 'cd /srv/collected && docker compose ps && docker compose logs --tail 20 app'
```

The git pull only matters when the compose file, env example, or seed config changed; the code runs from the image. Migrations apply when the container starts; boot logs `migrations applied` with the tags it ran, or nothing when the schema is current. Right after a restart the box is busy for about two minutes (image load, six boot-time syncs, often a scheduled Canvas sync) and the container can show unhealthy because the 5-second probe times out; it recovers on its own and Docker doesn't restart on unhealthy. Rollback is checking out the previous commit and repeating from the build.

> **Not yet done on the box:** a nightly backup (`sqlite3 data/collected.db ".backup /srv/backups/collected-$(date +%F).db"` in cron), and connecting the sources on the live site, which is a Settings step there, not a deploy step.

## If you rewrite the backend

Keep these and the web app keeps working unchanged. They're listed in the order they'd bite you.

1. **The route paths and JSON shapes in chapter 10**, and the types in `shared/`. The web app has no other knowledge of the server.
2. **Effective items exactly as in chapter 6.** Every widget's notion of done, hidden, and duplicate comes from it.
3. **Id conventions** from chapter 4. Links, overrides, mappings, and the web app's caches all key on them.
4. **Upsert with soft delete inside a scope.** Ingesters must be re-runnable and must never destroy overrides or links.
5. **Source status semantics**: needs_auth must be distinguishable from error, because the UI tells you to reconnect for one and shows the message for the other.
6. **Encryption at rest with the key beside the data**, and a visible failure state when the key doesn't match.
7. **The Todoist push rules** in chapter 8. The dangerous mistakes are reopening a task and creating duplicates; the marker in the description is the safeguard.
8. **Migrations on startup**, or an equivalent, so the schema and the code always ship together.
9. **The health route without auth**, or the container never reports healthy.
10. **One process serving both the API and the static files**, or add a second service to compose and point the tunnel at it.

Things you're free to change: the language and framework, the ORM, the scheduler, the shape of `raw` as long as the keys the web app reads survive (course code and colour on items, `eventKind` and `date` on manual events, `projectName` and `parentId` on tasks, `location` on events, the grading fields on Canvas assignments), and anything about how the ingesters talk to their sources, provided they produce the same rows.

The decisions record in `artifacts/DECISIONS.md` explains why each of these is the way it is. Read it before undoing one.

