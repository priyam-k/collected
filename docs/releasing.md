# Releasing the CLI

The CLI lives in `agent/` and is published to npm as `collected-cli`. The server and web app are not published anywhere; they deploy from `main` (see `artifacts/SETUP.md`).

A release is a git tag. `.github/workflows/release.yml` watches for tags named `cli-v<version>`, runs typecheck and tests, builds the web app and then `agent/dist` with tsup (the `@collected/shared`, `@collected/core` and `@collected/server` workspace packages are bundled in), smoke-tests the packed tarball, and publishes with npm provenance.

## What the package is

`collected-cli` is the CLI and, in local mode, the whole app. The tarball holds `dist/` only: the bundle (`cli.js` plus its chunks; client mode never loads the local-mode chunk), `dist/drizzle` (the migrations), `dist/fixtures` (what `collected demo` loads), `dist/seed-config.json` (the example seed: no courses, the jobs feed and the to-do defaults) and `dist/web` (the Vite build `collected ui` serves). No sources, tests or sourcemaps. Everything the bundle imports at runtime (`@libsql/client`, `drizzle-orm`, `hono`, `@hono/node-server`, `croner`, `node-ical`, `cheerio`, `pino`, `zod`, `jose`, the Google libraries, `fetch-cookie`, `tough-cookie`) is a `dependency` of `agent/package.json` at the same range `core/` and `server/` declare; a package the bundle imports but the manifest does not declare fails the smoke test below with a module-not-found error, which is the point of the test. `@libsql/client` pulls one prebuilt binary per platform as an optional dependency (`@libsql/darwin-arm64`, `@libsql/linux-x64-gnu`, …), so the install needs no compiler.

**The web build is a precondition.** `pnpm --filter collected-cli build` copies `web/dist` into `agent/dist/web` and fails with a message when there is no `web/dist/index.html`. Build web first (`pnpm build:cli` does both in order).

## Client and server versions

The CLI and the server are released separately (npm tag and `main` deploy), so they meet at different versions. The rule is **same major = compatible**: a 1.x CLI talks to any 1.x server. Every `/api/*` answer carries `X-Collected-Version` (the server's version) and `X-Collected-Min-Client` (the oldest CLI it talks to), and `GET /api/system/version` reports both as `version` and `minClient`. The CLI reads the headers off whatever request it is making (`agent/src/skew.ts`): behind in minor, it prints one stderr line a day saying to run `collected upgrade`; on another major, or below `minClient`, it refuses with exit 2 before sending anything else.

`minClient` is `MIN_CLIENT_VERSION` in `core/src/lib/version.ts`. **Raising it is a breaking-change decision**, not housekeeping: every CLI below it stops working against the server the moment the server deploys, and the person sees only "run `collected upgrade`". Raise it only when an API change actually breaks older CLIs: a route or query parameter an old command sends is removed or renamed, a response field an old command reads goes away or changes meaning, a write's body shape changes. Adding routes, fields or commands never requires it (an old CLI simply lacks them). When you do raise it:

1. Set it to the first CLI version that works with the change (usually the one you are releasing alongside), and publish that CLI **before** the server change deploys, so `collected upgrade` has something to install.
2. Say so in `CHANGELOG.md` under the server release, naming the oldest CLI that still works.
3. Add a DECISIONS entry if the break was avoidable and you chose it anyway.

A new major of the CLI or the server is the same decision at a larger scale: bump both majors together, or not at all.

## One-time setup

1. Create an npm granular access token: npmjs.com → Access Tokens → Generate New Token → Granular. Scope it to the single package `collected-cli` with read and write, nothing else. It must be publish-capable and should have an expiry.
2. Add it to the repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
3. For the very first publish the package does not exist yet, so the token must be allowed to create packages ("all packages" for that one run, then narrow it), or publish the first version once by hand with `pnpm --filter collected-cli publish --access public` from a logged-in machine.

## Cutting a release

```sh
# 1. bump the version in agent/package.json (semver; the tag must match it exactly)
cd agent && npm version 1.1.0 --no-git-tag-version && cd ..

# 2. make sure everything is green locally, including the package as a user gets it
pnpm -r typecheck && pnpm -r test && pnpm build:cli && pnpm smoke:cli

# 3. commit the bump on main through a pull request as usual, then tag the merged commit
git tag cli-v1.1.0
git push origin cli-v1.1.0
```

The workflow refuses to run if the tag does not match `agent/package.json`'s `version`, so a mistyped tag fails fast instead of publishing a stale build.

## The smoke test

`scripts/smoke-cli-package.mjs` (`pnpm smoke:cli`) is what stands between a broken package and npm: 1.1.0 shipped uninstallable (a workspace package declared as a dependency) and nothing before publish would have noticed. It packs `agent/` with `npm pack`, installs that tarball into a fresh `npm init -y` project in a temp directory outside the repo (real dependency resolution from the registry, no workspace in sight), then with `COLLECTED_AGENT_HOME` in another temp dir runs `init --local`, `demo canvas`, `demo todoist`, `agenda --json` (must parse), `courses` (must list the demo courses), and `ui --no-open --port <free>`: waits for `/api/health`, fetches `/dashboard`, picks one `/assets/*.js` URL out of the HTML and fetches it (200, JavaScript), sends SIGINT and expects a clean exit; finally `npx -y -p <tarball> collected help`. It prints the tarball and installed sizes. `release.yml` runs it after the build and before `publish`; `ci.yml` runs it on every branch as the `package` job. Run it yourself before tagging; pass a tarball path to test a specific one, and `SMOKE_KEEP=1` keeps the temp directories for a look.

Check the run under Actions → release. When it finishes, `npm view collected-cli version` shows the new version and the package page shows a provenance badge linking back to the commit.

## After

- `collected upgrade` on your own machine (or `npm i -g collected-cli@latest`) and run `collected --version` once; it should print the version you tagged.
- If the release changed the config file format or added a command, update `agent/README.md` and the README's "CLI and file sync" section in the same pull request as the bump.
- A broken release is fixed forward with the next patch version; npm allows unpublishing only within 72 hours and the workflow does not do it for you.
