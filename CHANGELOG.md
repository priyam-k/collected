# Changelog

Every user-visible change gets a bullet. The format is read by the app's update check (`server/src/lib/changelog.ts`),
so keep it exact: a heading `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>`, then one `-` bullet per
change. Unshipped work goes under `## Unreleased`, which the parser skips; the release that ships it renames the
heading. `recommended` means a self-hoster should pull it (a fix, a security change, a source that would otherwise
break); `optional` means it is nice to have.

## Unreleased

- Assignments can be pushed into Google Tasks as well as Todoist: Settings → To-do apps → Google Tasks picks a list (created if missing) and whether the course code prefixes the title; the due day is the assignment's day in your timezone and the time is in the notes. Same rules as the Todoist push: never reopens, never writes back to Canvas or Gradescope, deletes are fused. `GET /api/todo/status` reports both apps for the settings page.

## 0.1.0 — 2026-10-28 · recommended

- Sign in with Google from the app itself; Cloudflare Access in front becomes optional. Sessions can be ended from Settings → Account.
- API tokens for the CLI (`collected login`), created and revoked under Settings → Account; a token can read the dashboard and make small edits but never touch credentials, settings or the layout.
- Onboarding imports your courses from Canvas enrollments on first run instead of needing a hand-written seed file.
- Google Calendar through a secret iCal address, read-only and without a Google Cloud project; OAuth stays for read and write.
- `collected connect canvas` reads the Canvas session cookie from your browser and posts it to the server, replacing the DevTools copy-paste.
- The UI moves to the Caustic design: warm grounds, one accent, tick instruments for grades and progress, glass only on floating surfaces.
- Update check for self-hosters: the app compares its running commit with upstream main every six hours, shows what changed and the commands to pull it, and ships as a prebuilt image on GHCR.
