# Progress

Last updated: 2026-10-24 (roadmap added; security review done, DECISIONS 043). Previously 2026-09-24: Deploys now run from GitHub Actions on push to `main` (DECISIONS 035); the deploy key and repo secrets still have to be set by hand once (SETUP.md Phase 2 step 9). The unused `applications` table is dropped (migration 0004). September's $0.24 GCP charge was egress from uncompressed API polling; responses are now gzipped + ETagged (DECISIONS 036); watch the October bill. Status as of 2026-09-09: M1–M8 done, M9 in progress: the e2-micro is up with the tunnel and Access in front, the first deploy's I/O problem is fixed (DECISIONS 024/025). Shipped to the box 2026-09-09 (image built on the Mac, main at 1df90e7): course pane, applications tracker, inline files, grades, course dates, schedule editor, the new UI, and the Progress / Clock / Exams / Announcements widgets; migrations 0002 and 0003 applied on boot. Next: connect the sources on prod, the backup cron, then two weeks of real use.

## Roadmap (2026-10-24)

Where this is going after v1, in the order the pieces depend on each other. Set on 2026-10-22; kept here so nothing drops out of sight. Phase 1 is done; the rest is the plan, not a commitment to dates.

**The pieces today.** Server + web in one container on the box, for everyone. The `collected` CLI and file sync (`agent/`) on the laptop, for anyone who wants files locally or agent access. The Canvas cookie helper (`local/canvas_cookie.py`) on the laptop, needed because UMD disabled Canvas API tokens. The vault skills (`/ingest`, `/canvas`, auto-ingest) in the notes vault: optional, and the notes agent's project, not this one.

**Two directions, one prerequisite.** Open source means someone runs the compose file without Cloudflare; hosted means we run it for other people. Both need the same three things first: in-app sign-in and sessions (Google first) so nothing depends on Cloudflare Access, per-user API tokens for the CLI replacing the Access service token, and onboarding from Canvas enrollments instead of `seed-config.json`. Open source comes first: it needs those three plus cleanup. Hosted also needs tenant isolation, a box that can carry several users' ingesters, and taking responsibility for other people's Canvas sessions. An invite-only beta for friends on the other server is the sensible middle step once isolation exists.

### Phase 1 — Security review and end-to-end tests
- [x] Full security review, seven surfaces, every finding verified (`SECURITY-REVIEW.md`, 2026-10-23).
- [x] Tier 1 and 2 fixes landed (DECISIONS 043, commit 4f22fca): fail-closed ingest, scoped credentials, outbound URL policy, CSRF and headers, agent containment, hardened deploy, pre-migration snapshots, dependency bumps.
- [ ] Manual steps the fixes created (SETUP.md steps 9 and 10): deploy secrets, `production` environment, branch protection, Dependabot alerts, backup cron on the box, the Access cookie's SameSite check in Zero Trust.
- [x] End-to-end tests (`e2e/`, 2026-10-26): Playwright over a fixture-seeded server, 23 specs covering the dashboard, course pane, overrides, dates, settings, export/import, layout, the CLI and the file-sync manifest/report; `pnpm e2e`, and the `e2e` job in `ci.yml`. Not covered: file bytes (need a live Canvas), Todoist writes (need a token), OAuth.

### Phase 2 — The shared prerequisite (sign-in, tokens, onboarding)
- [x] In-app sign-in and sessions (DECISIONS 044, 2026-10-26): Google identity, `users`/`sessions` tables, `collected_session` cookie; Access optional and still honoured when configured.
- [x] Per-user API tokens for the CLI: `collected login`, Settings → Account, `token:<name>` identity scoped like a service token. Behind Access the CLI still carries the service token to pass the edge.
- [x] Onboarding from Canvas enrollments (DECISIONS 045): `GET/POST /api/onboarding/canvas`, Import from Canvas in Settings → Courses, first-run card on an empty dashboard; `seed-config.json` is an example.
- [x] The laptop side is one thing: `collected login`, `collected connect canvas` (Chrome/Brave/Edge/Arc/Firefox cookie read in Node; `local/` deleted), `collected files link …`, `collected install-launchd`.
- [x] `skills/collected/SKILL.md` for AI agents: reads, Canvas browsing, writes that need confirmation, file-sync rules, how to read the output.

### Phase 3 — Open-source release
- [x] Scrub the repo (2026-10-26): `seed-config.json` is a generic example (still loaded on first boot); fixtures use fictional course ids, instructor names and calendar names; `artifacts/previous.txt` is gone; the owner's domain, instance, zone, username and GitHub path are placeholders in SETUP, REFERENCE, PROGRESS, DESIGN, `.env.example` and the agent config comment; the workflow's host key comes from the `DEPLOY_HOST_KEY` secret and the deploy job is gated by the `DEPLOY_REPO` variable (both to set, SETUP.md step 9); the Canvas URL is entered when connecting, with no default anywhere. `local/` still names the old domain until `collected connect canvas` retires it.
- [x] LICENSE (AGPL-3.0-only), SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md with the DCO sign-off and the note that `main` deploys the maintainer's instance (2026-10-26).
- [x] README with screenshots from the demo fixtures (`docs/screenshots/`, 2026-10-26). `agent/` is `collected-cli` on npm: `release.yml` publishes on a `cli-v*` tag (`docs/releasing.md`; needs the `NPM_TOKEN` secret).
- [ ] A landing page; a first-run flow in the web UI.
- [x] CI running typecheck, tests and `pnpm audit` on pull requests (`ci.yml`).
- [x] Secrets scan of the whole git history (clean, 2026-10-23; repeat right before flipping to public).
- [ ] Self-host path in SETUP.md that works without Cloudflare (needs Phase 2's sign-in).
- [ ] Flip the repo to public.

### Phase 4 — Hosted, invite-only first
- [ ] The parked multi-user plan (memory and `Later` below): `user_id` on every user-owned table with composite keys, isolation tests, per-user ingest mutex and rate limits, Postgres, app/worker split, webhooks for Todoist and Google Calendar.
- [ ] Hosted-only hardening from the review's Tier 3: resolver-level outbound URL checks or an allow-list of LMS hosts, relative paths in the agent's reports, per-user OAuth state.
- [ ] Capacity: the e2-micro cannot carry several users' ingesters; the other server or OCI.
- [ ] Decide whether "hosted" means invited friends or anyone who shows up; the second needs all of the above before the first invite, the first can start after isolation.

### Moving hosting (whenever)
Roughly half an hour, because the tunnel is the identity, not the box: on the new box install Docker and `cloudflared` with the same tunnel token, copy `data/` (database, key file, backups), recreate `.env`, `compose up`; remove the connector on the old box. Cloudflare needs nothing. In GitHub change the `DEPLOY_HOST` and `DEPLOY_USER` secrets, put the deploy public key in the new box's `authorized_keys`, replace the pinned host key in `deploy.yml`; an ARM box needs `--platform linux/arm64` on the build. The laptop needs nothing. Still to answer: the other server's OS, CPU architecture, RAM and location, to decide whether it is a better home than the e2-micro.

### Open decisions
- License: MIT is the default unless there is a reason to prefer Apache-2.0.
- Hosted audience: invited friends or the public.

## Milestones

- [x] **M0 — Design.** DESIGN, DECISIONS, SETUP, seed-config written.
- [x] **M1 — Skeleton.** pnpm workspaces (server, web, shared). Hono boots, runs Drizzle migrations, serves `/api/health` and the built SPA. Vite dev proxy. Cloudflare Access middleware with `AUTH_DISABLED` bypass. Dockerfile + compose. `.env.example`.
- [x] **M2 — Dashboard shell.** Grid with edit mode, registry, layout persistence per breakpoint, `useWidgetSize` hook + container queries, add/hide tray. Sources widget (reads `sources`). Settings page shell with JSON export/import.
- [x] **M3 — Canvas.** Cookie-jar ingester (planner items, courses, assignments, announcements), iCal fallback, `needs_auth` handling. Courses seeded from `seed-config.json`. Class widget (multi-instance). Local cookie helper.
- [ ] **M4 — Gradescope.** Scraper (student + TA courses), per-course `submits_via` dedup + fuzzy linking, manual link UI in settings.
- [x] **M5 — Google Calendar.** OAuth connect flow, incremental sync, calendar widget with all tiers, quick-add event write-through.
- [x] **M6 — Todoist.** Ingester (projects, sections, labels, tasks). Todo widget grouped by label with homework section fed by assignments. Push sync module with the one-way rules, behind a toggle.
- [x] **M7 — Jobs.** Simplify listings.json poller, deterministic filter from seed-config, jobs widget (tape + list), star/hide/applied state.
- [x] **M8 — Polish.** Mobile stack layout, PWA manifest, visibility-aware polling, empty/error states on every widget, keyboard shortcut for edit mode.
- [ ] **M9 — Deploy.** VPS, tunnel, Access, backups. Prod connect of all sources.
  - [x] Google Cloud e2-micro (`<instance>`, `<zone>`), Docker, repo cloned with a deploy key, Cloudflare Tunnel + Access, `collected.example.com` resolves (2026-09-07).
  - [x] First-deploy fixes (2026-09-07): jobs sync batched and diffed, health probe unauthenticated, Node heap capped, web/server build stages split, image built on the Mac and shipped as a tarball. Container healthy, cloudflared quiet, public URL answering in ~100 ms.
  - [x] GitHub Actions deploy on push to `main` (2026-09-24): `.github/workflows/deploy.yml`. Pending by hand: the deploy keypair into instance metadata, `DEPLOY_SSH_KEY` secret, `DEPLOY_HOST` / `DEPLOY_USER` variables.
  - [x] Ops Agent on the box is inactive and disabled (checked 2026-09-24).
  - [ ] Connect the sources on prod: every source except jobs is `disconnected` there. Canvas cookie, Gradescope login, Todoist token, Google Calendar connect — all in Settings → Sources on the prod site.
  - [ ] Backup cron on the box (`scripts/backup.sh`, SETUP.md step 10). **Do this next**: the 2026-10-01 incident had nothing to restore from; the pre-migration snapshot now covers schema changes only.
  - [x] Security review (`SECURITY-REVIEW.md`, 2026-10-23): Tiers 1 and 2 fixed (DECISIONS 043). Left: license, fixture scrubbing, `previous.txt`, and the dashboard checks (Access cookie SameSite, GCP snapshots).
  - [ ] Post-fix manual steps (SETUP.md 9 and 10): `gh secret set DEPLOY_HOST/DEPLOY_USER`, create the `production` environment with a required reviewer, protect `main`, enable Dependabot alerts, add the backup cron on the box and verify a dump; keep GCP snapshots until then.
- [ ] **M10 — Live for two weeks.** Fix whatever the first real semester week exposes before adding anything new.

## Post-run checklist (needs you)

- [ ] Canvas: run `pnpm canvas-cookie` (it now accepts `canvas_session`, which is what UMD's Canvas sets, and scans every Chrome profile) or paste the cookie in Settings → Sources, then `pnpm sync canvas`. Confirm the six courses get Canvas ids (Settings → Courses) and CMSC330 shows as TA with no homework rows.
- [ ] Canvas iCal: paste your personal feed URL (Canvas → Calendar → Calendar Feed) as the fallback.
- [ ] Gradescope: enter the native email + password in Settings → Sources, then `pnpm sync gradescope`. Confirm CMSC330 shows the grading queue and CMSC422/MATH423 get Gradescope ids. Then set `submits_via` per course (Settings → Courses) and check the linked-assignments list.
- [ ] Google Calendar: connected on 2026-09-06. Clearing the demo data reset the calendar selection to the primary calendar once; re-tick the calendars you want in Settings → Sources. Original note: create the OAuth client (SETUP.md Phase 1; register both `http://localhost:5173/api/google/callback` and `http://localhost:3000/api/google/callback` plus the prod URI), put the id/secret in `.env`, restart `pnpm dev`, then Settings → Sources → Connect Google Calendar. Tick the calendars you want. Try the + button in the calendar widget; the event should appear in Google within a second.
- [ ] Todoist: paste the API token in Settings → Sources (again, if you did it before the key change), `pnpm sync todoist`, check the to-do widget sections (Settings → Todoist sync → sections). Then **Preview** the push, read the list, and only then **Push now** / enable the automatic push. Close one pushed task by hand in Todoist and confirm the next preview leaves it alone.
- [ ] Jobs: the widget is live against the real Simplify feed already. Star a few, tune Settings → Jobs if the matches feel off (the exclude regex is the lever).
- [ ] Try `pnpm cli demo canvas` / `pnpm cli demo gradescope` / `pnpm cli demo gcal` / `pnpm cli demo todoist` any time you want fixture data in a fresh database. Demo rows are tagged and removable with `pnpm cli demo clear` or Settings → Export / import → Remove demo data (done on 2026-09-06; the dev database now holds only real Google Calendar and Todoist rows plus the job feed).

## Backlog from first real use (2026-09-07)

Done the same day, on the Mac, not yet shipped to the box (build on the Mac and ship the image, SETUP.md Phase 2 step 7):

- [x] Settings nav appended path segments on every click. Links are absolute now.
- [x] Course pane: click a course anywhere (overview, class widget, item popover) for schedule, links, every assignment, modules and files, announcements, syllabus.
- [x] Job pane + Applications widget: stages, applied date, next action, notes, resume path; manual entries; board or list. The widget is on the dashboard already (added while testing; hide it from edit mode if unwanted).
- [x] Canvas files open inline (PDFs render in the tab) via `/api/canvas/files/:id/open`; a download icon keeps the old behaviour.

Second batch, 2026-09-08, also local only:

- [x] Grades: Canvas assignment groups with weights and drop rules, a Canvas-style current grade per course, a Grades tab (categories expand to assignments, weight editor for custom categories and title regexes), current percent in the classes overview.
- [x] Dates: exam/quiz/final entries and cancelled/virtual session tags per course, a Dates tab with a month grid (class days shaded), everything showing on the calendar automatically, next-meeting logic honouring cancellations.
- [x] Schedule editor: drag on a week grid in the course dialog; JSON still available.

UI overhaul, 2026-09-09, built on the `new-ui` branch, merged to main and deployed the same day: the "Collected Dashboard v2" design applied to tokens (light and dark), the dashboard header, every widget, the drawer, and settings. Merge with `git merge new-ui` on main when it has been lived with; Settings → Layout → Reset positions puts the widgets in the mock's arrangement.

Widgets added 2026-09-09 on `new-ui`: Progress (BetterCanvas-style completion rings), Clock, Exams (countdown), Announcements (feed with per-browser read state). Job feed minimum height is 4 rows (compact cards under 165px); classes overview goes down to 2 columns.

Still open:

- **Widget stacking** (several widgets in one grid slot with tabs) and the broader **UI overhaul**. The pane removed most of the pressure; revisit after two weeks of use.
- The first real use of the tracker will show whether `screen` and `ghosted` earn their place or should fold into neighbours.

## Deferred from the v1 plan

- Timezone override in settings (the server uses `TZ`, the web uses the browser zone; identical for one user).
- Jobs settings: per-rule "what this excludes" sample. The live match counter is there.
- Docker build verification on the Mac (blocked by Docker Desktop networking; see Environment notes). Build on the VPS with `--platform linux/amd64` or natively.

## File sync (started 2026-10-01)

- [x] Server: `courses.file_sync`, `file_sync_state` (migration 0005), folder paths + module names on Canvas file rows (all files, not 30), decision logic in `shared`, `/api/file-sync/*`, service-token and helper-key identities.
- [x] Agent workspace: `collected-agent init | auth | courses | link | sync | status | install-launchd`, staging cache, hard links, `_collected.md` or a per-course index, Jev classification over HTTP (DECISIONS 039), report. Unit tests cover placement and the model request/response; a live Jev call is untested until the first real run.
- [x] Web: Sync panel in the course Files tab (folders, rules, fallback, per-file decision and override, make-rule, device paths); folder path and module under files.
- [x] Live on the Mac (2026-10-01): Access service token, five courses linked into the Obsidian vault, launchd every 30 min, Jev key set.
- [x] Policy and mechanics pass with the vault's ingest session (DECISIONS 040): display names, mirrored folders with `flatten`, adoption by content hash, atomic writes with Canvas mtimes, skip rules, handouts, `pull`, course facts files.
- [x] Files reachable only through links (syllabus PDFs, assignment specs in hidden folders) are ingested and routed (2026-10-01): 10 found across LING260, ENME480, CMSC422.
- [x] 2026-10-01 incident: config-only course updates reset schedule and links on five courses (DECISIONS 041). Route fixed and tested; four schedules and one hotlink restored from residual bytes in the database file; **CMSC422's class time needs re-entering**.
- [x] Blank notes: keep syncing them; the vault's agent deletes a blank once its filled version has synced (2026-10-01).
- [x] `collected` CLI (DECISIONS 042): dashboard reads with `--json`, edits (tasks, hotlinks, schedule, notes, dates, tracker), read-only Canvas browsing through `/api/canvas/raw`.

## Later

Parked 2026-09-24 while the multi-user question is worked out (see the discussion notes when they land in DESIGN/DECISIONS):

- **Multi-user hosting**: sign-in (Google OAuth for identity first), `user_id` on every user-owned table, shared job feed with per-user state, security audit, capacity (the e2-micro will not carry several users' ingesters). Possibly a local/self-host mode for people who won't hand credentials to a box they don't run.
- **More sources**: Google Tasks; Apple Reminders if there is any sane API.
- **Per-source write toggles**: sources are read-only by default; writes (Todoist close/push, Google event create, later Canvas submissions or planner overrides) become explicit opt-ins in source settings.
- **Multiple pages/screens**: several dashboards (overview, jobs, classes, one per class) each with their own grid, plus other surfaces such as a side panel of small widgets. Layouts are already per breakpoint; they would become per (page, breakpoint).

- Haiku job scorer over new matches with a short profile blurb.
- Resume pipeline: launchd job on the Mac calls the API for starred jobs, runs the resume skill, posts back a path.
- Pinloop as a second job source if it beats the repo on freshness.
- Canvas write-back: planner override when marking done in the dashboard.
- Applications tracker widget.
- Piazza / Ed unanswered-posts feed for the 330 TA role.
- TerpLink events.

## Environment notes

- Prod box: e2-micro, 1 GB RAM + 2 GB swap, 30 GB standard disk (~45 write IOPS). `gcloud compute ssh <instance> --zone <zone>`. Everything lives in `/srv/collected`; `data/` is owned by uid 1000 (see SETUP.md step 6).
- Docker Desktop on the Mac intermittently hangs on registry pulls. When it works, `docker build -t collected:dev . && docker run --rm -p 127.0.0.1:3100:3000 -e AUTH_DISABLED=true -v collected-data:/data collected:dev` boots the production image: verified 2026-09-06 (health, SPA, API, manifest, key file in the volume, non-root user, survives restart).
- The encryption key now lives in `data/.secret_key` (auto-created) instead of only in `.env`, after a recreated `.env` lost the original key. Credentials entered before that change (Gradescope, Todoist) must be re-entered once; the Sources page says so per source.

## Open questions

- Which Canvas planner items UMD returns for TA enrollments (may need separate handling).
- Whether UMD's Canvas has an idle timeout shorter than one day (the cookie experiment will show it; 15-minute polling covers any value above that).
- Whether the `New-Grad-Positions` repo is wanted now or only the internships repo. Seed includes internships only.
- Office hours for CMSC330 TA — TBD, fill in `seed-config.json` or settings.
