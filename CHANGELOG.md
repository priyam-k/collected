# Changelog

Every user-visible change gets a bullet. The format is read by the app's update check (`core/src/lib/changelog.ts`),
so keep it exact: a heading `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`, then one `-` bullet per
change. Unshipped work goes under `## Unreleased`, which the parser skips; the release that ships it renames the
heading. `recommended` means a self-hoster should pull it (a fix, a security change, a source that would otherwise
break); `optional` means it is nice to have.

## Unreleased

## 1.2.4 — 2026-10-30 · recommended

- Settings → Sources, Canvas card: the Canvas URL field is prefilled from the saved address (the server now publishes it as `meta.baseUrl`; the cookie stays encrypted and never comes back), accepts a bare host or any page address (`umd.instructure.com`, `umd.instructure.com/courses/1`, `http://…`) and saves it as `https://<host>`, and the Save/Replace cookie button says why it is off (address first, then the cookie) instead of looking like a rejected cookie. Pasted text with no `name=value` in it is flagged inline.
- CLI: `collected connect canvas` reads Firefox on Windows (`%APPDATA%\Mozilla\Firefox\Profiles`) and Linux (`~/.mozilla/firefox`, the snap and flatpak sandboxes), Chrome/Edge/Brave on Windows (the `Local State` key unwrapped through DPAPI in PowerShell; `v20` app-bound cookies are reported as such with the paste fallback) and Chromium browsers on Linux (the basic `peanuts` store, or the keyring password through `secret-tool`; a locked keyring is named). Before this, every browser read as "not installed" off macOS and the error said the cookie was missing. The "no cookie" error now lists each browser's outcome: not installed, N profiles without the cookie, or why the store could not be read. macOS is unchanged.

## 1.2.3 — 2026-10-30 · optional

- CLI: one timer for everything a laptop keeps current. Bare `collected sync` now means every enabled source (local mode, the same run as `sync all`) and then the file sync, or the file sync alone against a server; `--dry-run` plans the files and syncs no source, and `sync <source|all>` stays the sources-only form. `collected daemon install|uninstall|status` works in both modes and runs that command every 15 minutes in local mode or 30 against a server (`--interval N`; `daemon.intervalMinutes` in `agent.json` wins), logging to `<data dir>/daemon.log` or `~/.collected/daemon.log`. `install-launchd` and `uninstall-launchd` still work as aliases and say so; `daemon install` unloads and deletes the old `com.collected.agent` LaunchAgent when it finds one, so the file sync never runs on two timers. `collected status` reports the daemon in both modes.

## 1.2.2 — 2026-10-30 · optional

- CLI: `collected pull` and the file sync follow Canvas's extra redirect to its file CDN. Canvas answers the verifier link with one more 302 before the bytes, and the downloader stopped there with "CDN redirected again". Up to three further hops are followed, each held to the same rule as the first: https, a public host, never a sign-in page, no credentials sent.
## 1.2.1 — 2026-10-30 · optional

- CLI and server versions are checked against each other. Every `/api/*` answer now carries `X-Collected-Version` and `X-Collected-Min-Client`, and `GET /api/system/version` reports `minClient` (the oldest CLI the server talks to; same major is otherwise compatible). The CLI compares off whatever request it was making: behind the server's minor, it prints one stderr line a day (`collected-cli 1.2.0 · server 1.3.0 · run: collected upgrade`); on another major or below `minClient` it refuses with exit 2 before sending anything else. The same daily line says when npm has a newer CLI than the one running, in local mode too; `NO_UPDATE_NOTIFIER=1` keeps that check off the network. `collected --version` prints the version; `collected upgrade [--dry-run]` installs the newest CLI with whatever installed this one (npm, pnpm or bun global; it prints the npm command when it cannot tell). The repository's `.npmrc` is gone (both keys were pnpm defaults and npm warned about them).

## 1.2.0 — 2026-10-29 · recommended

- The backend is split into `@collected/core` (database, ingesters, syncs, sessions, scheduler) and the `server` HTTP layer over it. Nothing changes for a running instance: the image runs the same bundle, and the migrations now ship from `core/drizzle` (`MIGRATIONS_DIR` in the image).
- CLI local mode: `collected init --local` runs the whole backend inside the command over a SQLite database on this machine (`~/.collected/data` by default), with no server, Docker or `.env`. Every command works unchanged; `collected demo <source>` loads fixture data to look around and `collected sync <source|all>` runs a source's sync in-process. The Canvas demo loader now creates courses from the fixture's enrollments when the database has none.
- CLI local mode is a complete product on one machine: `collected ui` serves the dashboard at `http://127.0.0.1:4848` (loopback only, no sign-in, `/` goes to the board, the scheduler runs while it is open, Ctrl-C stops it cleanly); reads sync a connected source whose last success is older than `freshness.maxAgeMinutes` (30) before answering, with `--fresh` and `--stale-ok` to force either way and a failed sync never blocking the answer; `collected daemon install|uninstall|status` installs a user-level timer (LaunchAgent on macOS, systemd user timer on Linux, a printed `schtasks` line on Windows) running `sync all` every 15 minutes. Every sync run now holds a lock file under `<data dir>/sync.lock/`, and two processes opening one database no longer race the migrations. Settings → Account reads as this machine's when running under `collected ui`.
- The npm package `collected-cli` is the whole app for local mode: it ships the built dashboard (`collected ui` no longer needs a checkout), the migrations, the demo fixtures and the example seed, so `npm i -g collected-cli` on a machine with only Node is the complete install. A fresh local database starts from the example seed (the jobs feed and the to-do defaults; no courses). `collected help` exits 0. Before publishing, the release workflow now installs the packed tarball into an empty project and runs local mode through it, the dashboard included, so a package that cannot install or serve cannot ship.
- CLI local mode connects Google Calendar and Google Tasks with no Google Cloud project: the package carries a Google "Desktop app" client, so `collected connect google [calendar|tasks]` (a temporary loopback listener, the consent screen in your browser, the result printed) and the Connect buttons in `collected ui` just work; a build without the built-in client says so on the Sources page. Every Google flow, server included, now sends PKCE. `~/.collected/.env` takes your own `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, a Todoist app's `TODOIST_CLIENT_ID` / `TODOIST_CLIENT_SECRET` for Sign in with Todoist, and `TZ`, `LOG_LEVEL`, `UPSTREAM_REPO`; nothing else is read from it, and it never touches the environment.
- CLI 1.1.1: the npm package installs again. 1.1.0 declared the workspace-only `@collected/shared` as a dependency even though it is bundled in, so `npm i collected-cli` failed with a 404 for that package.
## 1.1.0 — 2026-10-28 · recommended

- New logo and wordmark ("collected."), a landing page built around a live demo of the real dashboard, and a `/demo` page.
- The board moves to `/dashboard`; `/` is always the home page, with Open dashboard when you are signed in. Signing in and newly installed apps land on the board. A bookmark of the root, or an app installed before this, opens the home page; re-bookmark `/dashboard` or reinstall to go straight to the board. Signing out now goes straight to the home page.
- Google Tasks as a second to-do source: its own Connect under Sources asking only for the tasks scope, tasks shown next to Todoist's in the to-do widget, and Settings → To-do sync → "Add new tasks to" picks where the add box sends.
- Assignments can be pushed into Google Tasks as well as Todoist: Settings → To-do sync → Google Tasks picks a list (created if missing) and whether the course code prefixes the title; the due day is the assignment's day in your timezone and the time is in the notes. Same rules as the Todoist push: never reopens, never writes back to Canvas or Gradescope, deletes are fused. Both pushes share one core; `GET /api/todo/status` reports both apps.
- Todoist connects with OAuth when the operator registered a Todoist app (`TODOIST_CLIENT_ID` / `TODOIST_CLIENT_SECRET`); pasting an API token still works.
- CLI: `collected task add` goes to the default to-do app (or `--to todoist|gtasks`, with `--due` for Google Tasks); `task done` closes tasks in either app; `cli demo gtasks` loads Google Tasks fixtures.
- Settings → About: version, commit, update status and project links; the profile menu shows the running build.
- The prod deploy bakes the commit into the image, so the update check has something to compare; `UPDATE_CHECK_TOKEN` lets a private upstream be checked.
- Many small UX fixes: confirmations before removals and imports, Escape returns to the board from Settings, scrolling lists instead of capped ones, overlapping week events side by side, loading and error states everywhere, phone layouts.
- Privacy policy and terms cover Google Tasks, Todoist sign-in and the assignment push.

## 1.0.0 — 2026-10-26 · recommended

- Sign in with Google from the app itself; Cloudflare Access in front becomes optional. Sessions can be ended from Settings → Account.
- API tokens for the CLI (`collected login`), created and revoked under Settings → Account; a token can read the dashboard and make small edits but never touch credentials, settings or the layout.
- Onboarding imports your courses from Canvas enrollments on first run instead of needing a hand-written seed file.
- Google Calendar through a secret iCal address, read-only and without a Google Cloud project; OAuth stays for read and write.
- `collected connect canvas` reads the Canvas session cookie from your browser and posts it to the server, replacing the DevTools copy-paste.
- The UI moves to the Caustic design: warm grounds, one accent, tick instruments for grades and progress, glass only on floating surfaces.
- Update check for self-hosters: the app compares its running commit with upstream main every six hours, shows what changed and the commands to pull it, and ships as a prebuilt image on GHCR.
