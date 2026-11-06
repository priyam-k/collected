# Changelog

One line per user-visible change, written for people, not a diff. The update check reads this file
(`core/src/lib/changelog.ts`), so headings are exact: `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`,
then `-` bullets. Unshipped work sits under `## Unreleased`, which the parser skips. `recommended` means a self-hoster
should pull it; `optional` means nice to have.

## Unreleased

## 1.7.0 — 2026-11-06 · recommended

- MCP: the server is a remote MCP endpoint at `/mcp` with OAuth sign-in, so the Claude apps (Settings → Connectors → Add custom connector) and other remote clients connect with the URL alone; the consent page picks the connector's access and the result is an ordinary scoped token in Settings → Account.
- CLI: the command module moved into the core package so the CLI, `collected mcp` and the server's endpoint run the same code.

## 1.6.0 — 2026-11-05 · recommended

- Tokens: Settings → Account creates tokens scoped per area (courses, jobs, calendar, tasks) and per direction (read, or read and write); a scoped token that oversteps gets a 403 naming what it lacks. Existing tokens are unchanged.
- CLI: `collected mcp` serves every command as an MCP tool on stdio, for Claude Code, Cursor and Claude Desktop (`claude mcp add collected -- collected mcp`).
- CLI: `collected login` and `auth token` say what the token may do.

## 1.5.0 — 2026-11-05 · recommended

- Jobs: tracker stages are editable (`jobs stages`, or set any stage name and it becomes a column); `new`, `starred` and `hidden` keep their meanings.
- Jobs: requisition ids read out of posting URLs, search across company, title, location, notes and req id, and a duplicate check when adding a job by hand (`jobs find`, `jobs search`).
- CLI: `jobs feed`, `jobs search`, `jobs find`, `jobs show`, `jobs add`, `jobs rm`, `jobs seen` and `jobs stages`; `jobs set` can edit notes, dates, resume path and req id without changing the stage.

## 1.4.1 — 2026-10-31 · recommended

- Dependencies: newer Google client libraries; the three audit advisories in their old dependency tree are gone.
## 1.4.0 — 2026-10-31 · recommended

- CLI: `collected quickstart` sets everything up as a conversation (where it runs, Canvas, courses, Google, Todoist, the timer, then your agenda), and `collected quickstart --agent` prints the same plan for an AI agent; also `collected courses import` and `collected connect todoist`.
- Homebrew: `brew install priyam-k/collected/collected-cli`; `collected upgrade` runs `brew upgrade` for that install.

## 1.3.0 — 2026-10-30 · recommended

- Canvas: the cookie field takes just the value, with the cookie name picked from a list.
- Canvas: personal access tokens as an alternative for schools that allow them (`collected connect canvas --token`).
- CLI: `connect canvas` reads Zen, LibreWolf, Floorp and Waterfox cookies too, and only mentions the Keychain when it will prompt.
- Landing: the agent setup prompt explains each step, offers to skip, and saves the skill for later sessions.

## 1.2.6 — 2026-10-30 · optional

- Calendar: only one event popover open at a time.
- Calendar: the week grid covers the whole day and opens scrolled to now.

## 1.2.5 — 2026-10-30 · optional

- CLI: `collected event add` creates Google Calendar events; `event calendars` lists your calendars.
- Dashboard: a small collected mark above the date links home.
- Landing: "Set up with your agent" prompt to paste into Claude Code, Cursor or Codex.
- Landing: ASCII wordmark sign-off at the bottom of the page.
- CLI: a second `COLLECTED_AGENT_HOME` gets its own sync timer.

## 1.2.4 — 2026-10-30 · recommended

- Settings: the Canvas cookie form prefills your Canvas address and says why Save is blocked.
- Settings: clicking Save on any incomplete source form marks the missing fields.
- CLI: `connect canvas` reads Firefox on Windows and Linux, and explains when Chrome's cookies can't be read.
- CLI: one `collected daemon install` keeps files and sources current in both modes.
- CLI: `collected pull` follows Canvas's redirect to its file CDN.
- CI runs on main; README gets badges and a three-way Run it section.

## 1.2.1 — 2026-10-30 · optional

- CLI and server check versions against each other; `collected upgrade` updates the CLI.
- `collected --version`.

## 1.2.0 — 2026-10-29 · recommended

- CLI local mode: `collected init --local` runs everything on one machine, no server needed.
- `collected ui` opens the dashboard at localhost.
- `collected connect google calendar|tasks` with a built-in Google client, no Cloud project needed.
- Reads sync first when data is stale; `--fresh` and `--stale-ok` to override.
- The npm package ships the dashboard, migrations and demo data.
- Internals split into a core package shared by the server and the CLI.

## 1.1.0 — 2026-10-28 · recommended

- New logo and wordmark; landing page rebuilt around a live demo.
- The board lives at `/dashboard`; `/` is the home page.
- Google Tasks as a second to-do app, including assignment push.
- Sign in with Todoist (OAuth) when the operator has a Todoist app.
- CLI: `task add` and `task done` work with Google Tasks too.
- Settings → About with version, commit and update status.
- Self-host update check: the app tells you when upstream has moved.
- Prebuilt Docker image on GHCR.

## 1.0.0 — 2026-10-26 · recommended

- Sign in with Google; Cloudflare Access becomes optional.
- API tokens for the CLI (`collected login`).
- Onboarding imports courses from Canvas.
- Google Calendar through a secret iCal address.
- `collected connect canvas` reads the Canvas cookie from your browser.
- Caustic design: new look across the app.
