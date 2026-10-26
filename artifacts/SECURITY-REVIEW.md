# Security review, 2026-10-23

Full read of the codebase at commit `ad39cc6` by seven parallel reviewers (auth, API input, secrets, ingesters, web, laptop agent, infra), each finding re-verified by hand before it was kept. Line numbers are as of that commit.

**Status (same day):** Tiers 1 and 2 are fixed in the working tree (DECISIONS 043), plus the code-side parts of Tier 3 (proxy path normalisation, same-origin pagination, outbound URL policy). Not done, by design: Tier 3's per-user model (the parked multi-user plan) and the dashboard checks at the end. Tier 4 (license, fixture scrubbing, `previous.txt`, owner identifiers in docs and workflows, the Canvas base URL default) was done 2026-10-26 for the open-source release. Manual steps the fixes created are listed in SETUP.md step 9 and 10 (secrets `DEPLOY_HOST`/`DEPLOY_USER`, the `production` environment, branch protection, Dependabot alerts, the backup cron).

Threat model used: today the app is single-user behind Cloudflare Access on a GCP e2-micro. Each finding says when it matters: **now**, **self-host** (someone runs the compose file without Cloudflare), **hosted** (we run it for other people, so the server is a third party to the laptop and users are third parties to each other), **public** (the repo itself goes public).

## Summary

Nothing is exploitable today by an outsider: Cloudflare Access gates every route, the JWT check is correct and fails closed, credentials are AES-256-GCM encrypted and never leave the server, the git history has no secrets, and the web app has no raw-HTML sink. The serious problems are three data-loss paths and two trust-boundary gaps that become real the moment the server and the laptop are not the same person's:

1. A transient Canvas failure is read as "zero assignments", which soft-deletes every assignment and then deletes the matching Todoist tasks. **now**
2. There is no backup of the database or the encryption key, and migrations run at boot with no snapshot. **now**
3. The laptop agent writes wherever the server's manifest says, with no containment check, so a hostile server has arbitrary file write on the laptop. **hosted**, defense-in-depth **now**
4. The Canvas base URL and other outbound URLs are user-settable with no host policy, and the `/api/canvas/raw` path filter is bypassable, which makes the server a GET proxy into its own network. **hosted**
5. No CSRF defense, no security headers, no body limit, two credentials (helper key, service token) that are full admin. **self-host** and **hosted**

Counts: 2 high, 14 medium, the rest low or informational. Everything below is ordered by what to fix first, not by category.

## Tier 1: fix now (data loss and defense in depth on the live deployment)

### 1.1 Swallowed Canvas errors cascade into deleting Todoist tasks (high)

`tryGetAll` in `server/src/ingest/canvas/client.ts:176` catches every non-auth error and returns `[]`. The per-course assignments call at `server/src/ingest/canvas/ingest.ts:86` uses it, so a Canvas 5xx, a network reset, or the runner's own timeout (the AbortController at `runner.ts:62` only aborts fetches, the run still resolves) produces an empty list for that course. `upsertItems` in `server/src/lib/items.ts:53` then soft-deletes every assignment in scope that was not seen. The run records as `connected`, the after-hooks fire, and `planPush` in `server/src/sync/todoist-push.ts:146` emits `delete` for every mapped item whose row is now deleted; `executePush` at line 208 calls `deleteTask` and drops the map row. The next good run restores the items but the map rows are gone, so each task is recreated: duplicate history, lost comments and reminders.

Fix: rethrow in `tryGetAll`/`tryGet` when `signal.aborted`; make the assignments call non-optional or track per-course failure and exclude failed courses from the delete scope; race the run against the timeout in the runner so a timed-out run is recorded as `error` and after-hooks do not run; refuse `delete` ops in `planPush` when the source's last run was not `connected` or when more than a threshold of mapped items vanished in one run. Also decide whether push should delete at all: CLAUDE.md says "only ever closes tasks", DESIGN.md says delete; the code follows DESIGN.

### 1.2 No backup; migrations run at boot with no snapshot (high)

Confirmed absent: PROGRESS.md line 22 still lists the backup cron as "do this next", and SETUP.md line 85 told us to turn GCP snapshots off on the promise of that cron. `runMigrations` (`server/src/db/migrate.ts:38`) migrates in place; a destructive migration has already shipped once (0004). The documented rollback (`docker tag collected:prev collected:latest`) cannot undo a schema change, and `prev` is the last loaded image, not the last healthy one (`deploy.yml:78`). The deploy also leaves the box crash-looping on a failed health check with no corrective step (`deploy.yml:91`).

Fix: nightly `sqlite3 .backup` plus a one-time copy of `.secret_key`, rotated, pushed to a bucket; copy the db file before applying pending migrations and log the path; in the workflow, tag `candidate`, swap to `latest` only after health passes, and roll back on failure. Note the CLI also runs `bootstrap()` and therefore migrates whatever database it points at.

### 1.3 Quadratic regex in `stripHtml` on instructor-controlled HTML (medium)

`server/src/ingest/canvas/map.ts:569` `.replace(/[ \t]+\n/g, '\n')` runs before any size cap. Measured: 64 KiB of spaces not followed by a newline takes 1.5 s; cost is quadratic, so a 1 MiB announcement pins the single-threaded box for minutes on every 15-minute run, and the API is unresponsive meanwhile. Same pattern in `agent/src/format.ts:61`.

Fix: slice input to ~200 KB first and replace the pass with `split('\n').map(l => l.trimEnd()).join('\n')`.

### 1.4 Ingester timeouts are advisory; Todoist retries 429 forever (medium)

The runner's abort signal is not threaded into the Todoist or Google Calendar clients (`todoist/ingest.ts:87`, `gcal/ingest.ts:115` do not accept it), no fetch has a per-request timeout, and `todoist/client.ts:33` recurses on 429 with no cap. A hung connection or sustained 429 leaves the source in `running` until a process restart, and every later run is "skipped: running". `/api/canvas/raw` and `/files/:id/open` pass no signal at all.

Fix: `AbortSignal.any([runSignal, AbortSignal.timeout(30_000)])` on every fetch; cap 429 retries; `Promise.race` the run against the timeout in `runIngester` so the mutex is always released.

### 1.5 No outbound response size cap (medium)

Every ingester buffers whole bodies (`res.text()` / `res.json()` at `canvas/client.ts:128`, `gradescope/client.ts:66`, `ical.ts:99`, `jobs/ingest.ts:39`). The jobs feed is a third-party GitHub URL; a multi-GB or infinite chunked response exhausts the 384 MB heap, Docker restarts, the boot pass refetches, crash loop.

Fix: stream with a byte budget and abort past it (20 MiB jobs, 5 MiB Canvas pages, 2 MiB HTML).

### 1.6 Dependency advisories reachable from code (medium)

`pnpm audit --prod`: hono 4.13.7 (`serveStatic` double-decode, patched 4.13.11; we use serveStatic for the SPA, impact here is only that `/%2561pi/...` returns index.html instead of 404), zod < 4.6.6 (memory exhaustion on oversized constrained collections, reachable through any authenticated POST). undici via cheerio and brace-expansion via googleapis are not on a request path. Dev-only: vite 7.3.6, vitest 3 in `agent` vs 4 elsewhere. Dependabot is disabled on the repo.

Fix: `pnpm up -r hono @hono/node-server zod vite vitest`; add a `pnpm.overrides` for undici; enable Dependabot for npm and github-actions; run `pnpm audit --prod --audit-level=high` in CI.

### 1.7 Agent trusts the manifest's target and the classifier's choice (medium now, critical hosted)

`targetDir` in `agent/src/config.ts:96` resolves `path.resolve(root, target)` with no containment check and accepts an absolute target outright. `sync.ts:184` passes `decision.target` straight from the manifest; `allowedTargets` is imported but used only for reporting (line 95). `classify.ts:85` returns the model's `choice` unvalidated, and a null confidence counts as "sure" in `shared/src/file-sync.ts:46`. The server knows every absolute path because the agent reports them. Today the server validates target names against `^[a-z][a-z0-9_-]*$` (`shared/src/schemas.ts:43`), so instructor content cannot reach this; a compromised server, or a plain-HTTP model endpoint on a hostile network, can. Concrete outcome: a manifest entry with target `/Users/<me>/Library/LaunchAgents` and a filename ending in `.plist`, plus a download redirect to a body of the server's choosing, is persistence as the user.

Fix: in the agent, reject any `decision.target` or model `choice` not in `allowedTargets(config)` and not matching the regex; after resolving, require the directory to be the root or under `root + sep` (realpath the root); one `assertInside(root, p)` before every place, write, move, unlink in `sync.ts` and `pull.ts`.

### 1.8 Agent download follows any redirect, unbounded (medium)

`agent/src/api.ts:105` fetches the server's `Location` with `redirect: 'follow'` and no scheme or host check, no size cap (the `maxFileMb` check is against the manifest's declared size, not the bytes), no timeout. Auth headers are correctly not sent on the second hop. The `fileId` is interpolated into the URL unencoded at line 98.

Fix: parse `Location`, require `https:`, reject loopback, link-local and RFC1918 hosts, use `redirect: 'manual'` on the second hop, count bytes and abort, `AbortSignal.timeout`, `encodeURIComponent(fileId)` plus a digits-only check.

## Tier 2: before open-sourcing (self-host without Cloudflare)

### 2.1 No standalone auth mode; AUTH_DISABLED is honoured in production (medium)

`env.ts:54` refuses to boot without Cloudflare vars unless `AUTH_DISABLED=true`, so a self-hoster without Cloudflare has two choices: Access, or nothing. A dev `.env` copied to a box is a fully open API that stores Canvas cookies and Gradescope passwords. `docker-compose.yml:9` applies `.env` with nothing overriding the flag; the only signal is one info log line and `authDisabled` on `/api/health`.

Fix: this is the "sign-in and sessions" prerequisite from the roadmap. Until then: refuse to boot when `NODE_ENV=production && AUTH_DISABLED` without an explicit acknowledgement variable, and warn, not info.

### 2.2 Helper key and service token are full admin; no rate limit (medium)

`verifyAccess` (`server/src/auth/cloudflare-access.ts:21`) accepts `x-collected-key` for every route before the JWT check; `.env.example:11` still describes it as the cookie drop-off secret. The service-token identity `service:<name>` is indistinguishable downstream: no route reads `c.get('user')`. The agent needs six routes; `~/.collected/agent.json` grants import, export, config writes, course deletion. No min length on `LOCAL_HELPER_KEY`, no throttle on 401s, and the early length check leaks key length (minor).

Fix: an allow-list in the guard keyed on identity prefix (`helper` only on the cookie route, `service:*` only on the agent's routes); `timingSafeEqual` over SHA-256 digests; min 32 chars; a per-IP 401 throttle. For hosted, per-user API tokens replace both.

### 2.3 CSRF: cookie-only auth, no Origin check, any Content-Type parsed (medium)

`cloudflare-access.ts:25` falls back to the `CF_Authorization` cookie; `util.ts:13` parses whatever body arrives; nothing checks `Origin` or `Sec-Fetch-Site`. A `text/plain` form POST from another site reaches every POST route (`/api/import`, `/api/sources/canvas/cookie`, `/api/calendar/events`, `/api/todoist/tasks/quick`, overrides, syncs) if the browser attaches the Access cookie cross-site. That depends on the Access application's SameSite setting, which lives in the Zero Trust dashboard and cannot be read from the repo. PUT/PATCH/DELETE need a preflight and are safe.

Fix: set the Access cookie to SameSite Lax or Strict in Zero Trust (check this now, it is a dashboard toggle); server-side, reject mutating requests whose `Origin` is present and not `PUBLIC_URL` or whose `Sec-Fetch-Site` is `cross-site`; require `content-type: application/json` in `parseBody` and `parsePatch`.

### 2.4 No security response headers (medium)

No `secureHeaders`, no CSP, no `frame-ancestors`, no `nosniff`, no `Cache-Control: no-store` on `/api` (responses carry an ETag and may sit in disk cache). Clickjacking is possible under the same SameSite condition as 2.3; a future `dangerouslySetInnerHTML` would be a full-origin compromise with no mitigation. The preview iframe at `web/src/panes/FilePreview.tsx:55` has no `sandbox`, and `previewKind` decides by file extension, so an instructor's `syllabus.pdf` that is actually HTML renders inside the dashboard modal (CDN origin, so it cannot touch the dashboard, but it can phish convincingly).

Fix: `hono/secure-headers` with `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, a script-src of `'self'` (move the inline theme script in `web/index.html`), image and frame sources for the InstFS hosts; `no-store` on `/api`; `sandbox` and `referrerpolicy` on the iframe; start with report-only for a day.

### 2.5 No request body limit (medium)

No `bodyLimit` anywhere; an authenticated 500 MB POST to `/api/import` is a repeatable OOM on the 384 MB heap. Free-text fields (`notes`, `name`, report `localPath`, `errors[].message`, settings values for unknown keys) have no `.max()`.

Fix: `bodyLimit({ maxSize: 1 MiB })` on `/api/*`, larger only on `/import`; `.max()` on free text.

### 2.6 Secrets on the command line and in two files (medium)

`collected auth service-token <id> <secret>` and `auth model <key>` (`agent/src/cli.ts:67`) put long-lived secrets in shell history and `ps`; the docs instruct exactly this. The same service token is also in the repo `.env` for `canvas_cookie.py` (0644 by default, not in `.env.example`). `state.json` and `agent.log` are 0644 and disclose the vault layout.

Fix: read secrets from stdin or a prompt; have the Python helper read `~/.collected/agent.json` instead of `.env`; 0600 on state and log; atomic write for `agent.json`.

### 2.7 Plain HTTP accepted for server, model and cookie target (medium)

`init <server-url>` accepts any scheme and `api.ts` sends the Access token and helper key to it; `classify.ts:54` sends the TypeSafe key to whatever `model.baseUrl` says; `canvas_cookie.py` posts the Canvas cookie to `COLLECTED_URL`. Fix: refuse `http:` unless the host is loopback, in all three.

### 2.8 Deploy workflow hardening (medium)

Actions pinned to mutable major tags (`deploy.yml:31-46`), no `permissions:` block (repo default is read-only today, but the file does not guarantee it), and the third-party actions share a job with `DEPLOY_SSH_KEY`. Once public: workflow logs are world-readable and a failed deploy dumps 40 lines of app logs plus the VM IP and SSH username (`DEPLOY_HOST`/`DEPLOY_USER` are variables, not masked secrets); `main` has no branch protection, so anyone with write access deploys to the box.

Fix: SHA-pin the five actions; `permissions: contents: read`; split build (no secrets) from deploy (`environment: production`, required reviewer, `if: github.repository == ...`); move host and user to secrets; drop the log dump; protect `main`.

### 2.9 Container and defaults (low)

`PUBLIC_URL` defaults to the owner's domain in compose; the Canvas base URL defaults to UMD in `shared/src/schemas.ts:237`, `sources.ts:179`, `web/src/lib/canvas.ts`, `SourcesPage.tsx`. Base image is a mutable tag; `chown -R node:node /app` lets the runtime user rewrite its own code; no `read_only`, `cap_drop`, `no-new-privileges`. `data/collected.db` is 0644 and the key file sits beside it, so any whole-directory copy of `data/` is every password. The Python helper installs an unpinned `browser-cookie3` with Keychain access and posts every cookie for the domain, not just the session ones.

### 2.10 Smaller server issues (low)

- `GET /api/jobs?limit=-1` is `LIMIT -1`, the whole table; `?limit=abc` is a 500 (`jobs.ts:46`, `items.ts:97`). Parse query with zod.
- `PUT /api/settings/__proto__` is a 500 (`settings.ts:29` `KNOWN[key]`); unknown keys accept any value with no size cap, including `fileSync.devices`.
- `POST /api/import` applies `courseInputSchema` defaults on conflict (`export.ts:40`), the same mechanism as the 2026-10-01 incident; document or guard.
- File-sync report: `fileId` and `target` not cross-checked against the course's files and allowed targets; no caps on `decisions`/`placed`; any device name can overwrite another device's entry (`lib/file-sync.ts:113-133`).
- Todoist marker rebuild matches the first `collected:` in a task description and the upstream URL is line 1, so a crafted `html_url` query string can bind a task to the wrong item (`todoist-push.ts:39`). Anchor the marker to its own line.
- Gradescope login POST follows 307/308 with the password body (`gradescope/client.ts:95`); Canvas cookies are set as domain cookies so they go to every subdomain (`canvas/client.ts:60`, add `hostOnly`).
- Google OAuth `state` is random and single-use but not bound to the requesting identity (`google.ts:12-38`); fine single-user, account-linking CSRF once there are two users. Expired entries are never pruned.
- `canvasOrigin()` in `web/src/lib/canvas.ts:26` matches any hostname containing `canvas`; a crafted `html_url` becomes the course header's Canvas link.
- Upstream URLs go into `href` unvalidated (jobs, hotlinks accept `javascript:` through zod's `.url()`); React 19 blocks the scheme today. Add a `safeHref` and validate `^https?://` at ingest.
- `pruneEmptyDirs` deletes `_collected.md` and `.DS_Store` without a hash check; `writeIfChanged` will overwrite anything at the configured index path, so the `_data/index.md` contract with the notes agent is enforced only by config; `findIdentical` follows symlinks. `safeSegment` lets `..` through for the cache dir (contained to `~/.collected`). Markdown handouts pass instructor frontmatter through and `canvas_id` is unquoted.
- `runOnPlace` is safe (user's own string, paths via env), but `COLLECTED_PLACED` carries instructor file names with shell metacharacters; document quoting.
- Server-controlled rule regexes and user job-filter regexes are compiled with no length or nesting limit (ReDoS; self-inflicted single-user).

## Tier 3: before hosting other people

Every route reads and writes global rows; there is no tenant column. This is the parked multi-user plan, and the review adds specifics to it:

- **Outbound URL policy** (high hosted): Canvas base URL, iCal URL, job feed URLs, and the `/api/canvas/raw` proxy. The path filter at `canvas.ts:57` is bypassed by `%2e%2e` (verified: `/api/v1/%2e%2e/%2e%2e/login` normalises to `/login`), query strings pass (`?access_token=` lets a caller use any Canvas token through our session), and `getAll` follows upstream `Link: next` to any host. With a tenant-set `baseUrl` of an internal address this is a GET proxy with JSON read-back into the provider network. GCP metadata specifically is closed (needs the `Metadata-Flavor` header). Fix: normalise then check origin and `/api/v1/` prefix and reject search/hash; same-origin check on `next`; one `safeOutboundUrl` helper (https only, resolve and reject private ranges, re-check per redirect) used by every ingester; an LMS host allow-list for hosted.
- Per-user API tokens for the CLI; remove the helper key; bind OAuth state to the user; per-user ingest mutex and rate limits; relative paths in the agent's report instead of absolute ones (the server currently learns the macOS username and vault layout every run).
- The agent-side containment fixes in 1.7 and 1.8 are mandatory here, not optional.

## Tier 4: repo hygiene before going public

- No `LICENSE`. Add MIT or Apache-2.0, plus `SECURITY.md` and a note that `main` auto-deploys the maintainer's box.
- Delete `artifacts/previous.txt` (a pasted private chat transcript).
- `artifacts/seed-config.json` is the owner's real schedule and line 95 states citizenship and sponsorship status; ship `seed-config.example.json`.
- Fixtures carry real UMD Canvas course ids, instructor surnames, office-hour rooms, the owner's name in the iCal calendar name (`feed.ics:6`) and in the demo Google calendar list (`gcal/mock-api.ts:38`), and real Gradescope course ids.
- Owner domain, instance name, zone, username, SSH host key and GitHub path appear in `docker-compose.yml:15`, `.env.example:17`, `deploy.yml:65`, `SETUP.md`, `REFERENCE.md`, `PROGRESS.md`, `DESIGN.md:5,29`, `local/README.md`, `canvas_cookie.py:5,66`, `agent/src/config.ts:10`.
- `.claude/` is not gitignored. `web/package.json` lists `react-resizable`, unused. `pnpm-workspace.yaml` still excludes `jose@6.2.12` from the release-age guard. Dockerfile does not copy `agent/package.json` into the deps stage.
- History: git author email on all commits; otherwise clean (no `.env`, `.db`, keys or token-shaped strings ever committed; largest blob is the lockfile). Rewriting history is not worth it; a fresh repo is the alternative if the identifiers above matter.

## What held up

Checked and fine, so nobody needs to re-check:

- JWT validation: JWKS from the team domain, `iss` and `aud` enforced, `exp` by default, RSA keys so no algorithm confusion, 10-minute cache with refetch on unknown kid, every failure is a 401. Spoofable identity headers are not consulted. The two open paths are exact-match and the cookie route re-authenticates itself; `/api/health` is the only anonymous route. Guard runs before compress and etag.
- Crypto: AES-256-GCM, fresh 12-byte IV, tag verified, key file 0600 and preserved through the Docker bind mount. `configEnc` is never returned, exported or logged; pino redacts cookie jars, tokens and the auth headers; no request logger; every `lastError` was checked for credential content.
- Drizzle: no string-built SQL anywhere. `parsePatch` is used by all three partial-update routes and no `.partial()` write path remains. `onError` returns a generic 500.
- Web: zero `dangerouslySetInnerHTML`/`innerHTML`/`srcdoc`/markdown; every upstream string is a text node; every external link is `target=_blank rel=noreferrer`; only theme and read-announcement ids in localStorage; no client-side authorization logic; OAuth redirects only to `PUBLIC_URL`.
- Agent: `safeName` and `subdirFor` block every traversal form on file names and Canvas folder paths (verified on `..`, `../x`, `a/../../b`, NUL); every hashed delete and move checks `placementUnmodified`; adoption hashes downloaded bytes, never a server-supplied hash; auth headers never follow a redirect; the CLI bundle has zero runtime dependencies and no install scripts; the classifier receives names and folder paths only, never file bytes.
- Ingesters: Canvas and Gradescope cookies cannot reach another registrable domain or plain HTTP (tough-cookie and fetch-cookie behaviour verified); Todoist token only goes to the Todoist host; pagination is bounded everywhere; the push never reopens a task and never writes to Canvas or Gradescope; Gradescope HTML is parsed with cheerio, not regex.
- Infra: `.env` and `data/` have never been committed and are excluded from the image; workflow triggers are push-to-main and manual only, so fork PRs never see secrets; host key pinned; key written 0600 and never echoed; `USER node`, `127.0.0.1` bind, no docker socket; pnpm builds blocked by default, `--frozen-lockfile` everywhere.

## Things to check in dashboards (not visible from the repo)

- Zero Trust → Access → Applications → collected → cookie settings: SameSite value and HttpOnly. This decides whether 2.3 and the clickjacking half of 2.4 are live today.
- Service token expiry date.
- Whether GCP snapshot scheduling is in fact off (SETUP.md said to turn it off).
