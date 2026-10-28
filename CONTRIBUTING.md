# Contributing

Thanks for helping. collected is small and opinionated; the rules below keep it that way.

## Dev setup

Five commands, assuming Node 22 or newer:

```sh
npm i -g pnpm
pnpm install --frozen-lockfile
cp .env.example .env            # then set AUTH_DISABLED=true; leave SECRET_KEY empty
pnpm cli demo canvas            # fixture data so the widgets are not empty (also: gradescope, gcal, todoist, gtasks)
pnpm dev                        # server on :3000, web on :5173
```

Open http://localhost:5173. `pnpm cli demo clear` removes the demo rows again.

## Running the checks

```sh
pnpm -r typecheck
pnpm -r test
```

Both run in CI on every pull request, plus `pnpm audit --prod --audit-level=high`. Tests never hit a real Canvas, Gradescope, Google or Todoist: fixtures (Gradescope HTML, Canvas JSON) live next to the parser they exercise. If you change a parser, change or add a fixture.

## Conventions

The ones that trip people up:

- **Ingesters** upsert by `(source, external_id)`, soft-delete what they no longer see, and always write their status to `sources`. An empty or failed upstream answer is never a deletion. Every ingester is also a CLI command (`pnpm sync <source>`); build and debug it that way first.
- **Todoist push is one-way.** It creates, updates, closes and deletes tasks for assignments; it never reopens a task and never touches Canvas or Gradescope from a Todoist event.
- **Every outbound fetch** goes through `server/src/lib/http.ts` (a deadline and a byte budget), and every user-settable URL is validated with `outboundUrlSchema` (https to a public host). Redirects and pagination links stay on the configured origin.
- **Mutating routes** parse bodies with `parseBody` / `parsePatch`; never read `c.req.json()` directly, never write `schema.partial()` back. Bound free-text fields in `shared/src/schemas.ts` with `.max()`.
- **Credentials have scope** (`identityAllows` in `server/src/api/index.ts`). New routes that touch credentials, settings, layout or import/export stay on the deny list for non-person identities.
- **The agent trusts nothing from the server about paths.** Targets are checked against `allowedTargets`, every vault write goes through `assertInside`, downloads follow only https redirects to public hosts.
- **Secrets** go through `server/src/lib/crypto.ts`, never on a command line in docs or help text, never logged or committed.
- **Widgets**: one folder under `web/src/widgets/<type>/`, one entry in `registry.ts`, every size tier from `useWidgetSize()`, and empty, loading and error states.
- **Docs**: `artifacts/DECISIONS.md` is append-only (new numbered entry when a decision changes); `artifacts/SETUP.md` and `docs/self-host.md` must stay accurate when env vars or flows change.
- **Dependencies**: none added casually. Open an issue first if a change needs one.

## Changelog

Every user-visible change adds a bullet to `CHANGELOG.md` under the `## Unreleased` heading, in the same pull request. The file is machine-read by the update check that self-hosters see, so the format is strict: a release heading is `## <major.minor.patch> — <YYYY-MM-DD> · <recommended|optional>` and each change is one `-` bullet under it. Cutting a release means renaming `## Unreleased` to that heading, bumping `version` in the root `package.json`, and adding a fresh `## Unreleased` above it. `server/src/lib/changelog.test.ts` parses the real file, so a malformed heading fails CI.

## Commits and pull requests

- Plain commit messages that describe the change. No emoji, no trailers other than the sign-off below.
- Commit at meaningful steps (a working ingester, a schema change, a milestone), not per file.
- **Sign off every commit** (Developer Certificate of Origin, https://developercertificate.org). This certifies that you wrote the change or have the right to submit it under the project's license:

  ```sh
  git commit -s -m "Describe the change"
  ```

  which appends `Signed-off-by: Your Name <you@example.com>` to the message. Pull requests with unsigned commits are not merged.

- **Pushes to `main` deploy the maintainer's own instance** (`.github/workflows/deploy.yml`), so nobody pushes to `main` directly. Open a pull request from a branch or a fork; CI runs with no secrets, a maintainer reviews, and the merge is what deploys.

By contributing you agree that your contributions are licensed under the AGPL-3.0-only license in `LICENSE`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
