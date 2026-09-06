# Progress

Last updated: 2026-09-06. Status: M1–M8 done. Next: M9 deploy once the VPS exists (artifacts/SETUP.md Phase 2), then two weeks of real use.

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
- [ ] **M10 — Live for two weeks.** Fix whatever the first real semester week exposes before adding anything new.

## Post-run checklist (needs you)

- [ ] Canvas: run `local/canvas_cookie.py` (see local/README.md) or paste the cookie in Settings → Sources, then `pnpm sync canvas`. Confirm the six courses get Canvas ids (Settings → Courses) and CMSC330 shows as TA with no homework rows.
- [ ] Canvas iCal: paste your personal feed URL (Canvas → Calendar → Calendar Feed) as the fallback.
- [ ] Gradescope: enter the native email + password in Settings → Sources, then `pnpm sync gradescope`. Confirm CMSC330 shows the grading queue and CMSC422/MATH423 get Gradescope ids. Then set `submits_via` per course (Settings → Courses) and check the linked-assignments list.
- [ ] Google Calendar: create the OAuth client (SETUP.md Phase 1; register both `http://localhost:5173/api/google/callback` and `http://localhost:3000/api/google/callback` plus the prod URI), put the id/secret in `.env`, restart `pnpm dev`, then Settings → Sources → Connect Google Calendar. Tick the calendars you want. Try the + button in the calendar widget; the event should appear in Google within a second.
- [ ] Todoist: paste the API token in Settings → Sources, `pnpm sync todoist`, check the to-do widget sections (Settings → Todoist sync → sections). Then **Preview** the push, read the list, and only then **Push now** / enable the automatic push. Close one pushed task by hand in Todoist and confirm the next preview leaves it alone.
- [ ] Jobs: the widget is live against the real Simplify feed already. Star a few, tune Settings → Jobs if the matches feel off (the exclude regex is the lever).
- [ ] Try `pnpm cli demo canvas` / `pnpm cli demo gradescope` / `pnpm cli demo gcal` / `pnpm cli demo todoist` any time you want fixture data in a fresh database. The dev database currently holds demo rows for Canvas, Gradescope, Google Calendar, and Todoist; `rm -rf data/` and restart to start clean before connecting real accounts.

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

- Docker Desktop on the Mac cannot pull images (Docker Hub requests hang inside the Docker VM; the host reaches Docker Hub fine). The Dockerfile is written but untested until Docker Desktop networking is fixed (try restarting Docker Desktop, or Settings → Resources → Network). The VPS build in M9 does not depend on this.

## Open questions

- Which Canvas planner items UMD returns for TA enrollments (may need separate handling).
- Whether UMD's Canvas has an idle timeout shorter than one day (the cookie experiment will show it; 15-minute polling covers any value above that).
- Whether the `New-Grad-Positions` repo is wanted now or only the internships repo. Seed includes internships only.
- Office hours for CMSC330 TA — TBD, fill in `seed-config.json` or settings.
