# Changelog

Every user-visible change gets a bullet. The format is read by the app's update check (`core/src/lib/changelog.ts`),
so keep it exact: a heading `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`, then one `-` bullet per
change. Unshipped work goes under `## Unreleased`, which the parser skips; the release that ships it renames the
heading. `recommended` means a self-hoster should pull it (a fix, a security change, a source that would otherwise
break); `optional` means it is nice to have.

## Unreleased

- The backend is split into `@collected/core` (database, ingesters, syncs, sessions, scheduler) and the `server` HTTP layer over it. Nothing changes for a running instance: the image runs the same bundle, and the migrations now ship from `core/drizzle` (`MIGRATIONS_DIR` in the image).
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
