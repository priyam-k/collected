# Progress

Last updated: 2026-09-06. Status: M1 skeleton done; building M2.

## Milestones

- [x] **M0 — Design.** DESIGN, DECISIONS, SETUP, seed-config written.
- [x] **M1 — Skeleton.** pnpm workspaces (server, web, shared). Hono boots, runs Drizzle migrations, serves `/api/health` and the built SPA. Vite dev proxy. Cloudflare Access middleware with `AUTH_DISABLED` bypass. Dockerfile + compose. `.env.example`.
- [ ] **M2 — Dashboard shell.** Grid with edit mode, registry, layout persistence per breakpoint, `useWidgetSize` hook + container queries, add/hide tray. Sources widget (reads `sources`). Settings page shell with JSON export/import.
- [ ] **M3 — Canvas.** Cookie-jar ingester (planner items, courses, assignments, announcements), iCal fallback, `needs_auth` handling. Courses seeded from `seed-config.json`. Class widget (multi-instance). Local cookie helper.
- [ ] **M4 — Gradescope.** Scraper (student + TA courses), per-course `submits_via` dedup + fuzzy linking, manual link UI in settings.
- [ ] **M5 — Google Calendar.** OAuth connect flow, incremental sync, calendar widget with all tiers, quick-add event write-through.
- [ ] **M6 — Todoist.** Ingester (projects, sections, labels, tasks). Todo widget grouped by label with homework section fed by assignments. Push sync module with the one-way rules, behind a toggle.
- [ ] **M7 — Jobs.** Simplify listings.json poller, deterministic filter from seed-config, jobs widget (tape + list), star/hide/applied state.
- [ ] **M8 — Polish.** Mobile stack layout, PWA manifest, visibility-aware polling, empty/error states on every widget, keyboard shortcut for edit mode.
- [ ] **M9 — Deploy.** VPS, tunnel, Access, backups. Prod connect of all sources.
- [ ] **M10 — Live for two weeks.** Fix whatever the first real semester week exposes before adding anything new.

## Later

- Haiku job scorer over new matches with a short profile blurb.
- Resume pipeline: launchd job on the Mac calls the API for starred jobs, runs the resume skill, posts back a path.
- Pinloop as a second job source if it beats the repo on freshness.
- Canvas write-back: planner override when marking done in the dashboard.
- Applications tracker widget.
- Piazza / Ed unanswered-posts feed for the 330 TA role.
- TerpLink events.

## Open questions

- Which Canvas planner items UMD returns for TA enrollments (may need separate handling).
- Whether UMD's Canvas has an idle timeout shorter than one day (the cookie experiment will show it; 15-minute polling covers any value above that).
- Whether the `New-Grad-Positions` repo is wanted now or only the internships repo. Seed includes internships only.
- Office hours for CMSC330 TA — TBD, fill in `seed-config.json` or settings.
