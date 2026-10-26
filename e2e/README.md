# e2e

End-to-end tests for collected: one real server on a throwaway database, every source replaced by its fixture
client or mock API, the built web app driven in Chromium, the built `collected` CLI run as a child process. Nothing
reaches the network.

## Run

```sh
pnpm install --frozen-lockfile
pnpm --filter e2e exec playwright install chromium   # once per machine (CI adds --with-deps)
pnpm e2e                                             # ~20 s locally
```

Useful variants, all from `e2e/`:

```sh
pnpm exec playwright test specs/cli.spec.ts          # one file
pnpm exec playwright test --grep "course pane"       # by title
pnpm exec playwright test --headed                   # watch it
pnpm exec playwright show-report                     # the HTML report of the last run
E2E_KEEP=1 pnpm e2e                                  # keep the temp dir (database, server.log) after the run
E2E_SERVER_LOG_LEVEL=debug pnpm e2e                  # chattier server.log
```

## What happens in a run

`global-setup.ts`:

1. Makes a temp directory (`collected-e2e-*` under the OS tmpdir) with a fresh `DATA_DIR`.
2. Builds `web/dist` if it is missing (`E2E_REBUILD=1` forces it) and always rebuilds `agent/dist` (fast).
3. Loads the demo data the way `pnpm cli demo <source>` does: `tsx src/cli.ts demo canvas|gradescope|gcal|todoist`,
   which runs the real ingesters against `server/src/ingest/*/fixture-client.ts` and `mock-api.ts`.
4. Starts `tsx src/index.ts` and waits for `GET /api/health`.

`global-teardown.ts` stops the server and deletes the temp directory.

Specs run on **one worker, in file order** (`cli`, `dashboard`, `file-sync`, `layout`, `settings`): they share the
database and a few of them change it. A spec that changes state it does not own undoes it in a `finally`.

## Ports and environment

| Variable                 | Value                                   |
| ------------------------ | --------------------------------------- |
| `PORT` / `PUBLIC_URL`    | `4300` / `http://localhost:4300` (override with `E2E_PORT`; the Vite dev server is not used, the server serves `web/dist`) |
| `AUTH_DISABLED`          | `true` (every request is the `dev` user) |
| `SCHEDULER_DISABLED`     | `true`                                   |
| `DATA_DIR`               | `<tmp>/data`                             |
| `SEED_CONFIG_PATH`       | `e2e/fixtures/seed-config.json` (four courses that match the Canvas and Gradescope fixtures) |
| `WEB_DIST`               | `web/dist`                               |
| `LOCAL_HELPER_KEY`       | random per run; the CLI is pointed at it through `COLLECTED_AGENT_HOME=<tmp>/agent-home` |
| `TZ`                     | `America/New_York` (server, CLI and browser agree) |

Shell variables that would change the server's behaviour (`CF_ACCESS_*`, `GOOGLE_*`, `SECRET_KEY`, `MIGRATIONS_DIR`)
are dropped before the server starts; a developer's `.env` cannot override them either (explicit env wins).

The specs reach the server two ways: the browser (`page`) and Playwright's `request` fixture, both on `baseURL`.
The CLI goes through `helpers.ts#cli()`, which runs `node agent/dist/cli.js` with the temp agent home.

## Adding a spec

1. Create `specs/<area>.spec.ts`. Import `expect, test` from `@playwright/test` and whatever you need from
   `../helpers.js` (`openDashboard`, `widget`, `pane`, `apiGet`, `apiSend`, `cli`, `cliOk`, `ensureAgentConfigured`).
2. Prefer `getByRole` / `getByText` / `getByLabel` / `getByPlaceholder`. Add a `data-testid` in `web/` only when
   there is no accessible handle, and nothing else.
3. If the spec changes shared state (overrides, courses, widgets, layout), restore it in a `finally` or make the
   change one a later spec can live with.
4. Keep the suite deterministic: no real time windows narrower than the fixtures allow (Canvas and Gradescope items
   are dated September 2026; the Todoist and Google demo rows are relative to today), unique names per run
   (`Date.now()`), no sleeps.
5. CLI assertions: `cli()` returns `{ status, stdout, stderr }`; `cliOk()` fails the test on a non-zero exit and
   returns stdout.

## What is covered, what is not

Covered: dashboard widgets from demo data; course pane and its assignments; mark done from the popover; manual
course dates; settings → courses rename; settings → sources statuses and the "Data pulled" panel; export → import
round-trip; add a widget from the tray, hide it, drag one, persistence across reloads; CLI reads (`courses`,
`assignments`, `todo`, `agenda`, `sources`, `course`), CLI writes (`notes`, `done`); file sync configuration,
decisions, manual override, agent link + dry-run plan, report round-trip, the sync panel in the drawer.

Not covered, and why:

- **File downloads.** The server never serves file bytes; it redirects to Canvas's CDN with a live session. Without
  Canvas a real `sync` fails closed on every file, which is what the spec asserts.
- **Todoist quick add (`task add`) and closing a Todoist task.** They call Todoist's API with a real token; the mock
  API is wired only into `cli demo todoist`. The spec asserts the CLI reports the failure cleanly.
- **Google OAuth, the Canvas cookie drop-off, Cloudflare Access.** No external identity provider in the loop.
- **Scheduler and `Sync all`.** The scheduler is disabled; a sync against a disconnected source is a no-op.
- **Jobs feed.** Needs the GitHub JSON; the widget shows its connect placeholder, which is asserted.
