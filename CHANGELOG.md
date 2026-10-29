# Changelog

Every user-visible change gets a bullet. The format is read by the app's update check (`core/src/lib/changelog.ts`),
so keep it exact: a heading `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`, then one `-` bullet per
change. Unshipped work goes under `## Unreleased`, which the parser skips; the release that ships it renames the
heading. `recommended` means a self-hoster should pull it (a fix, a security change, a source that would otherwise
break); `optional` means it is nice to have.

## Unreleased

- The backend is split into `@collected/core` (database, ingesters, syncs, sessions, scheduler) and the `server` HTTP layer over it. Nothing changes for a running instance: the image runs the same bundle, and the migrations now ship from `core/drizzle` (`MIGRATIONS_DIR` in the image).
- CLI local mode: `collected init --local` runs the whole backend inside the command over a SQLite database on this machine (`~/.collected/data` by default), with no server, Docker or `.env`. Every command works unchanged; `collected demo <source>` loads fixture data to look around and `collected sync <source|all>` runs a source's sync in-process. The Canvas demo loader now creates courses from the fixture's enrollments when the database has none.
- CLI local mode is a complete product on one machine: `collected ui` serves the dashboard at `http://127.0.0.1:4848` (loopback only, no sign-in, `/` goes to the board, the scheduler runs while it is open, Ctrl-C stops it cleanly); reads sync a connected source whose last success is older than `freshness.maxAgeMinutes` (30) before answering, with `--fresh` and `--stale-ok` to force either way and a failed sync never blocking the answer; `collected daemon install|uninstall|status` installs a user-level timer (LaunchAgent on macOS, systemd user timer on Linux, a printed `schtasks` line on Windows) running `sync all` every 15 minutes. Every sync run now holds a lock file under `<data dir>/sync.lock/`, and two processes opening one database no longer race the migrations. Settings → Account reads as this machine's when running under `collected ui`.
- The npm package `collected-cli` is the whole app for local mode: it ships the built dashboard (`collected ui` no longer needs a checkout), the migrations, the demo fixtures and the example seed, so `npm i -g collected-cli` on a machine with only Node is the complete install. A fresh local database starts from the example seed (the jobs feed and the to-do defaults; no courses). `collected help` exits 0. Before publishing, the release workflow now installs the packed tarball into an empty project and runs local mode through it, the dashboard included, so a package that cannot install or serve cannot ship.
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
