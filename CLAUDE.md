# collected

Personal student dashboard: Canvas, Gradescope, Google Calendar, Todoist, and a job feed in one grid of rearrangeable widgets. Single user.

## Read first
- `artifacts/OVERVIEW.md` — the backend landscape in ten minutes: what runs, the data model by purpose, write path, read path, what is load-bearing. Start here.
- `artifacts/DESIGN.md` — architecture, data model, ingesters, sync rules, widget system. The spec.
- `artifacts/DECISIONS.md` — why things are the way they are. Append a new numbered entry when a decision changes; don't rewrite old ones.
- `artifacts/PROGRESS.md` — milestone checklist and open questions. Update it when a milestone lands or a question gets answered.
- `artifacts/SETUP.md` — external setup steps (Google Cloud, Cloudflare, VPS). Keep it accurate when env vars or flows change.
- `artifacts/seed-config.json` — courses, Todoist structure, job filter. Loaded on first boot.

`artifacts/` is docs only. No code lives there.

## Stack
pnpm workspaces: `server` (Hono + Drizzle + libsql + croner), `web` (Vite + React + TS + Tailwind + shadcn + TanStack Query + react-grid-layout), `shared` (types, schemas, the file-sync decision function), `agent` (the `collected` CLI on the laptop: dashboard reads and small edits, read-only Canvas browsing, and the file sync that puts course files in local folders), `local` (Mac helper scripts). Docker Compose for prod. Cloudflare Tunnel + Access in front.

## Conventions
- Every ingester is also a CLI command (`pnpm sync <source>`). Build and debug it that way before wiring it to the scheduler.
- Ingesters upsert by (source, external_id), soft-delete what they no longer see, and always write status to `sources` — success or failure.
- Secrets go through `server/src/lib/crypto.ts` and are never logged or committed. `.env` is gitignored; keep `.env.example` current.
- Widgets: one folder under `web/src/widgets/<type>/`, one entry in `registry.ts`. Handle every tier from `useWidgetSize()` and render empty/loading/error states.
- Todoist push sync is one-way: it creates, updates, closes, and deletes the task for an assignment removed at the source, and nothing else. Never write code that reopens a task or touches Canvas/Gradescope from a Todoist event. Deletes are fused (`planPush`): none while the item's source is not `connected`, none on a mass removal.
- An empty or failed upstream answer is never a deletion. `upsertItems` skips its soft-delete pass on zero rows; a per-course fetch that fails leaves that course out of the delete scope; a timed-out run is an error and runs no after-hooks.
- Every outbound fetch goes through `server/src/lib/http.ts`: a deadline (`withTimeout`) and a byte budget (`readText`). Every user-settable URL the server will fetch is validated with `outboundUrlSchema` (https to a public host). Redirects and pagination links must stay on the configured origin.
- Credentials have scope (`identityAllows` in `server/src/api/index.ts`): the helper key opens one route, a service token does what the CLI needs and nothing destructive. New routes that touch credentials, settings, layout, or whole-database import/export must stay on the deny list for non-person identities.
- Mutating routes parse bodies with `parseBody`/`parsePatch` (which require `application/json`); never read `c.req.json()` directly. Bound every free-text field in `shared/src/schemas.ts` with `.max()`.
- The agent trusts nothing from the server about where to write: targets are checked against `allowedTargets`, every vault write goes through `assertInside`, downloads follow only https redirects to public hosts. Keep it that way in new agent code.
- Secrets never go on a command line in docs or help text; the CLI reads them from a prompt or stdin.
- Tests don't hit real sources. Fixtures for Gradescope HTML and Canvas JSON live next to the parser.
- Partial updates go through `parsePatch` (`server/src/api/util.ts`), never `schema.partial()` written back: zod 4 fills defaults for omitted fields and that once emptied five courses' schedules.
- File sync: the server stores target *names*; filesystem paths exist only in the agent's `~/.collected/agent.json`. The agent never overwrites or removes a file whose bytes changed since it placed it.

## Git
- Commit at meaningful steps: a milestone, a working ingester, a schema change. Not per file, not per tweak.
- Plain messages describing the change. No Co-Authored-By, no session trailers, no emoji.
- Don't push unless asked.
