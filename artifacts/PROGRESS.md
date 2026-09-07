# Progress

Last updated: 2026-09-07. Status: M1–M8 done, M9 in progress: the e2-micro is up with the tunnel and Access in front, and the first deploy's I/O problem is fixed (DECISIONS 024/025). Next: connect the sources on prod, the backup cron, then two weeks of real use.

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
  - [x] Google Cloud e2-micro (`collected-instance-2`, `us-east1-c`), Docker, repo cloned with a deploy key, Cloudflare Tunnel + Access, `collected.priyamkabra.com` resolves (2026-09-07).
  - [x] First-deploy fixes (2026-09-07): jobs sync batched and diffed, health probe unauthenticated, Node heap capped, web/server build stages split, image built on the Mac and shipped as a tarball. Container healthy, cloudflared quiet, public URL answering in ~100 ms.
  - [ ] Disable the Ops Agent on the box (command in SETUP.md step 3). Not done yet.
  - [ ] Connect the sources on prod: every source except jobs is `disconnected` there. Canvas cookie, Gradescope login, Todoist token, Google Calendar connect — all in Settings → Sources on the prod site.
  - [ ] Backup cron (SETUP.md VPS step 5).
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

Noted during the deploy; none of these block M9. Do them locally, push, then build on the Mac and ship the image (SETUP.md Phase 2 step 7). The box cannot build.

- **Settings nav appends instead of replacing.** Clicking tabs builds `/settings/sources/courses/todoist`; the links need absolute paths (or `relative="path"`) so each click replaces the segment.
- **Interactive, denser UI.** Widget stacking instead of one widget per course; clicking a class opens a detail view (assignments, links, files, announcements, hotlinks) rather than needing a widget for each thing.
- **UI overhaul** once the above shape is settled.
- **File previews.** Canvas file links currently download; try a preview (Canvas hosts the files, so a `/preview` or inline URL shape may exist) instead of fetching everything.

## Deferred from the v1 plan

- Timezone override in settings (the server uses `TZ`, the web uses the browser zone; identical for one user).
- Jobs settings: per-rule "what this excludes" sample. The live match counter is there.
- Docker build verification on the Mac (blocked by Docker Desktop networking; see Environment notes). Build on the VPS with `--platform linux/amd64` or natively.

## Later

- Haiku job scorer over new matches with a short profile blurb.
- Resume pipeline: launchd job on the Mac calls the API for starred jobs, runs the resume skill, posts back a path.
- Pinloop as a second job source if it beats the repo on freshness.
- Canvas write-back: planner override when marking done in the dashboard.
- Applications tracker widget.
- Piazza / Ed unanswered-posts feed for the 330 TA role.
- TerpLink events.

## Environment notes

- Prod box: e2-micro, 1 GB RAM + 2 GB swap, 30 GB standard disk (~45 write IOPS). `gcloud compute ssh collected-instance-2 --zone us-east1-c`. Everything lives in `/srv/collected`; `data/` is owned by uid 1000 (see SETUP.md step 6).
- Docker Desktop on the Mac intermittently hangs on registry pulls. When it works, `docker build -t collected:dev . && docker run --rm -p 127.0.0.1:3100:3000 -e AUTH_DISABLED=true -v collected-data:/data collected:dev` boots the production image: verified 2026-09-06 (health, SPA, API, manifest, key file in the volume, non-root user, survives restart).
- The encryption key now lives in `data/.secret_key` (auto-created) instead of only in `.env`, after a recreated `.env` lost the original key. Credentials entered before that change (Gradescope, Todoist) must be re-entered once; the Sources page says so per source.

## Open questions

- Which Canvas planner items UMD returns for TA enrollments (may need separate handling).
- Whether UMD's Canvas has an idle timeout shorter than one day (the cookie experiment will show it; 15-minute polling covers any value above that).
- Whether the `New-Grad-Positions` repo is wanted now or only the internships repo. Seed includes internships only.
- Office hours for CMSC330 TA — TBD, fill in `seed-config.json` or settings.
