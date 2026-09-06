# collected

Personal student dashboard: Canvas, Gradescope, Google Calendar, Todoist, and a job feed in one grid of rearrangeable widgets. Single user.

## Read first
- `artifacts/DESIGN.md` — architecture, data model, ingesters, sync rules, widget system. The spec.
- `artifacts/DECISIONS.md` — why things are the way they are. Append a new numbered entry when a decision changes; don't rewrite old ones.
- `artifacts/PROGRESS.md` — milestone checklist and open questions. Update it when a milestone lands or a question gets answered.
- `artifacts/SETUP.md` — external setup steps (Google Cloud, Cloudflare, VPS). Keep it accurate when env vars or flows change.
- `artifacts/seed-config.json` — courses, Todoist structure, job filter. Loaded on first boot.

`artifacts/` is docs only. No code lives there.

## Stack
pnpm workspaces: `server` (Hono + Drizzle + better-sqlite3 + croner), `web` (Vite + React + TS + Tailwind + shadcn + TanStack Query + react-grid-layout), `shared` (types), `local` (Mac helper scripts). Docker Compose for prod. Cloudflare Tunnel + Access in front.

## Conventions
- Every ingester is also a CLI command (`pnpm sync <source>`). Build and debug it that way before wiring it to the scheduler.
- Ingesters upsert by (source, external_id), soft-delete what they no longer see, and always write status to `sources` — success or failure.
- Secrets go through `server/src/lib/crypto.ts` and are never logged or committed. `.env` is gitignored; keep `.env.example` current.
- Widgets: one folder under `web/src/widgets/<type>/`, one entry in `registry.ts`. Handle every tier from `useWidgetSize()` and render empty/loading/error states.
- Todoist push sync is one-way and only ever closes tasks. Never write code that reopens a task or touches Canvas/Gradescope from a Todoist event.
- Tests don't hit real sources. Fixtures for Gradescope HTML and Canvas JSON live next to the parser.

## Git
- Commit at meaningful steps: a milestone, a working ingester, a schema change. Not per file, not per tweak.
- Plain messages describing the change. No Co-Authored-By, no session trailers, no emoji.
- Don't push unless asked.
