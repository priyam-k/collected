# Changelog

One line per user-visible change, written for people, not a diff. The update check reads this file
(`core/src/lib/changelog.ts`), so headings are exact: `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`,
then `-` bullets. Unshipped work sits under `## Unreleased`, which the parser skips. `recommended` means a self-hoster
should pull it; `optional` means nice to have.

## Unreleased

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
