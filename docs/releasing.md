# Releasing the CLI

The CLI lives in `agent/` and is published to npm as `collected-cli`. The server and web app are not published anywhere; they deploy from `main` (see `artifacts/SETUP.md`).

A release is a git tag. `.github/workflows/release.yml` watches for tags named `cli-v<version>`, runs typecheck and tests, builds `agent/dist` with tsup (the `@collected/shared` workspace package is bundled in), and publishes with npm provenance.

## One-time setup

1. Create an npm granular access token: npmjs.com → Access Tokens → Generate New Token → Granular. Scope it to the single package `collected-cli` with read and write, nothing else. It must be publish-capable and should have an expiry.
2. Add it to the repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
3. For the very first publish the package does not exist yet, so the token must be allowed to create packages ("all packages" for that one run, then narrow it), or publish `0.1.0` once by hand with `pnpm --filter collected-cli publish --access public` from a logged-in machine.

## Cutting a release

```sh
# 1. bump the version in agent/package.json (semver; the tag must match it exactly)
cd agent && npm version 0.1.0 --no-git-tag-version && cd ..

# 2. make sure everything is green locally
pnpm -r typecheck && pnpm -r test && pnpm --filter collected-cli build

# 3. commit the bump on main through a pull request as usual, then tag the merged commit
git tag cli-v0.1.0
git push origin cli-v0.1.0
```

The workflow refuses to run if the tag does not match `agent/package.json`'s `version`, so a mistyped tag fails fast instead of publishing a stale build.

Check the run under Actions → release. When it finishes, `npm view collected-cli version` shows the new version and the package page shows a provenance badge linking back to the commit.

## After

- `npm i -g collected-cli@latest` on your own machine and run `collected help` once.
- If the release changed the config file format or added a command, update `agent/README.md` and the README's "CLI and file sync" section in the same pull request as the bump.
- A broken release is fixed forward with the next patch version; npm allows unpublishing only within 72 hours and the workflow does not do it for you.
