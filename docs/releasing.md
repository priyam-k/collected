# Releasing the CLI

The CLI lives in `agent/` and is published to npm as `collected-cli`. The server and web app are not published anywhere; they deploy from `main` (see `artifacts/SETUP.md`).

A release is a git tag. `.github/workflows/release.yml` watches for tags named `cli-v<version>`, runs typecheck and tests, builds the web app and then `agent/dist` with tsup (the `@collected/shared`, `@collected/core` and `@collected/server` workspace packages are bundled in), smoke-tests the packed tarball, and publishes with npm provenance. A second job then points the Homebrew tap at the published tarball (see [The Homebrew tap](#the-homebrew-tap)).

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

The workflow publishes without any npm token. On npmjs.com → `collected-cli` → Settings → Trusted publishers, one entry: GitHub Actions, organization or user `priyam-k`, repository `collected`, workflow filename `release.yml` (the filename only), environment empty, "Allow npm publish" ticked. pnpm exchanges the job's OIDC token for a short-lived credential; a mismatch in any field shows up in the log as `Skipped OIDC … 404` and the publish fails, so recreate the entry rather than guess.

A fork publishing under its own package name does the first publish by hand (`pnpm --filter collected-cli publish --access public` from a logged-in machine; trusted publishing is configured on an existing package), then adds its own trusted publisher entry.

The two repository secrets the release does need are `COLLECTED_GOOGLE_DESKTOP_CLIENT_ID` and `COLLECTED_GOOGLE_DESKTOP_CLIENT_SECRET` (artifacts/SETUP.md, Google step 9); the publish refuses a bundle without them. A third, `HOMEBREW_TAP_TOKEN`, is optional and lets the workflow update the Homebrew tap (below).

## The Homebrew tap

`brew install priyam-k/collected/collected-cli` installs the CLI from the tap repository [`priyam-k/homebrew-collected`](https://github.com/priyam-k/homebrew-collected). The tap holds one formula, `Formula/collected-cli.rb`, which downloads the exact tarball npm serves for one version (`url` plus its `sha256`), runs `npm install` against it under Homebrew's own `node`, and links `collected` and `collected-agent` into `brew --prefix`/bin. Nothing is built; the formula is a pointer to the npm release.

The formula's source of truth is in this repository, `homebrew/Formula/collected-cli.rb`, next to the tap's README. After every successful publish the `brew` job of `release.yml` runs `node scripts/bump-formula.mjs <version> --wait 300`, which asks the registry for that version (retrying for up to five minutes, since the registry lags a publish), downloads the tarball, checks it against the registry's sha512 integrity, writes its sha256 and URL into the formula, and pushes the formula and README to the tap as the commit `collected-cli <version>` under the `github-actions[bot]` identity. The job never fails the release: without the secret it prints what to do and exits 0.

One-time setup, done once by the repository owner:

1. Create the empty repository `priyam-k/homebrew-collected` (public; Homebrew needs no README or branch to start from, the first push creates `main`).
2. Create a fine-grained personal access token at github.com → Settings → Developer settings → Fine-grained tokens: resource owner `priyam-k`, repository access "Only select repositories" → `homebrew-collected`, repository permissions `Contents: Read and write` (Metadata: read is added automatically), nothing else. Give it an expiry you will remember; the job tells you when it stops working.
3. Store it as the repository secret `HOMEBREW_TAP_TOKEN` on `priyam-k/collected` (`gh secret set HOMEBREW_TAP_TOKEN` and paste it at the prompt).

The template in `homebrew/` is not committed back by the workflow, so it may lag the tap by one release; the tap is authoritative, and `brew install` reads only the tap. To bring the template up to date, run `node scripts/bump-formula.mjs <version>` locally and commit the result, or leave it for the next release's bump commit.

Two Homebrew details worth knowing. Its npm step runs with `--ignore-scripts` and `--min-release-age=1`, so no install script of any dependency runs and a dependency version published in the last 24 hours is passed over for the newest older one that satisfies the range (the CLI's own tarball is handed to npm as a file, so the cooldown never applies to it). And Homebrew 7 asks before loading a third-party tap: the fully qualified `brew install priyam-k/collected/collected-cli` trusts that one formula on its own, while someone who runs `brew tap priyam-k/collected` first is told to run `brew trust priyam-k/collected`.

To test a change to the formula itself before it ships, Homebrew 7 wants it inside a tap, so stage it in a local one under the real name and remove it afterwards:

```sh
brew tap-new --no-git priyam-k/collected
cp homebrew/Formula/collected-cli.rb "$(brew --repository priyam-k/collected)/Formula/"
brew trust priyam-k/collected
brew audit --strict --new priyam-k/collected/collected-cli
brew install priyam-k/collected/collected-cli && brew test collected-cli && collected --version
brew uninstall collected-cli && brew untap priyam-k/collected && brew untrust priyam-k/collected
```

`brew style homebrew/Formula/collected-cli.rb` needs no tap and catches most formula-shape mistakes on its own.

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

Check the run under Actions → release. When it finishes, `npm view collected-cli version` shows the new version and the package page shows a provenance badge linking back to the commit; a few minutes later the tap's newest commit is `collected-cli <version>` and `brew upgrade collected-cli` installs it.

## After

- `collected upgrade` on your own machine (or `npm i -g collected-cli@latest`, or `brew upgrade collected-cli`) and run `collected --version` once; it should print the version you tagged.
- Optionally `node scripts/bump-formula.mjs <version>` and commit, so the formula template in `homebrew/` matches the tap.
- If the release changed the config file format or added a command, update `agent/README.md` and the README's "CLI and file sync" section in the same pull request as the bump.
- A broken release is fixed forward with the next patch version; npm allows unpublishing only within 72 hours and the workflow does not do it for you.
