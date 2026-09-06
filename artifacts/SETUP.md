# Setup — external things you do by hand, and when

Nothing external is required before coding starts. Everything below is needed the day the matching ingester is built (Phase 1) or the day it goes public (Phase 2).

## Local development (what already works)

```sh
npm i -g pnpm && pnpm install
cp .env.example .env    # then set AUTH_DISABLED=true and LOCAL_HELPER_KEY=$(openssl rand -hex 16); leave SECRET_KEY empty
pnpm dev                # http://localhost:5173
```

`.env.example` ships with `AUTH_DISABLED=false` on purpose: copying it verbatim onto the VPS must never disable the login check. Only the local `.env` sets it to `true`. If the server prints `Invalid environment`, that line tells you exactly which variable to fix.

**The encryption key.** Stored credentials (Canvas cookie, Gradescope password, tokens) are encrypted with a key that lives in `data/.secret_key`, created automatically on first boot and kept next to the database (inside the Docker volume in production). Leave `SECRET_KEY` empty in `.env`. If you ever recreate `.env` nothing is lost. If you delete `data/` or that key file, every credential must be re-entered; the Sources page will say so.

pnpm 12 blocks install scripts by default; `pnpm-workspace.yaml` allow-lists `esbuild`. SQLite comes from `@libsql/client` (prebuilt for every Node version), so there is nothing to compile.

## Phase 0 — now, optional but cheap

- **Todoist**: rename the "Homework" project to **School** (project ids survive renames, so timing doesn't matter). Grab the API token: Todoist → Settings → Integrations → Developer → API token. Keep it for Phase 1.
- **Gradescope**: confirm you can log in at `https://www.gradescope.com/login` with email + password (not the school SSO button). If not, set one via account settings or the forgot-password flow.
- **Chrome**: keep Canvas logged in; the local helper reads that cookie.

## Phase 1 — during development, as each ingester lands

All of these are entered in the app's Settings page (or `.env` for the Google client), locally first.

### Todoist
Paste the API token into Settings → Sources → Todoist.

### Canvas
Either run the local helper, which reads the cookie from Chrome and posts it to the running app (it creates `local/.venv` and installs its one dependency the first time; expect a Keychain prompt):

```sh
pnpm canvas-cookie                    # expects the dev server on :3000
pnpm canvas-cookie -- --dry-run       # just list what it found
```

or by hand: Chrome DevTools → Application → Cookies → `umd.instructure.com` → copy `_normandy_session` (and `canvas_session` if present) into Settings → Sources → Canvas. Also paste the iCal feed URL from Canvas → Calendar → Calendar Feed, for the fallback.

### Gradescope
Email + password into Settings → Sources → Gradescope. Then in Settings → Courses, set each course's Gradescope course id (the number in the course URL) and `submits_via`.

### Google Cloud (needed the day the calendar ingester is built)
1. `https://console.cloud.google.com` → New project, name it `collected`.
2. APIs & Services → Library → enable **Google Calendar API**.
3. APIs & Services → OAuth consent screen → External. App name `collected`, your email for support and developer contact. Scopes: add `.../auth/calendar.events` and `.../auth/calendar.readonly`. Add yourself as a test user.
4. **Publish the app** (Publishing status → In production). Ignore the "needs verification" notice; unverified is fine for a personal app. This is what stops refresh tokens from expiring after 7 days. You can defer this: in Testing status everything works, but the connection silently dies after 7 days and you reconnect from Settings → Sources. Google may show "ineligible test user" while adding yourself; if your address is listed under Test users afterwards, it took.
5. Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URIs (the app builds the URI from `PUBLIC_URL`, which is the Vite server in dev):
   - `http://localhost:5173/api/google/callback`
   - `http://localhost:3000/api/google/callback`
   - `https://collected.priyamkabra.com/api/google/callback`
6. Copy client id + secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. Restart `pnpm dev` so the server picks up the new `.env`. In the app: Settings → Sources → Google Calendar → Connect. Click through the "unverified app" warning (Advanced → Go to collected). Pick which calendars to show and which one new events go to.

### Jobs
Nothing. Public GitHub files.

## Phase 2 — deploy

### VPS (Hetzner)
1. `https://console.hetzner.cloud` → new project → Add server. Location: Ashburn (US East). Image: Ubuntu 24.04. Type: smallest shared x86 (CX-series; avoid ARM to keep Docker images simple). Add your SSH public key. Firewall: allow inbound 22 only. Nothing else needs to be open; the tunnel is outbound.
2. SSH in. Install Docker: `curl -fsSL https://get.docker.com | sh`, then `usermod -aG docker $USER`.
3. Layout for multiple projects on one box:
   ```
   /srv/collected/      this repo, its own docker-compose.yml, binds 127.0.0.1:3000
   /srv/<other>/        each project binds its own 127.0.0.1:<port>
   /srv/backups/
   ```
   Run **one** `cloudflared` on the host as a systemd service (`cloudflared service install <token>`), not one per project. It routes every hostname to a local port. Each project's compose stays independent.
4. `git clone` into `/srv/collected`, copy `.env.example` → `.env`, fill it (`AUTH_DISABLED=false`, `PUBLIC_URL=https://collected.priyamkabra.com`, the Cloudflare and Google values from below; leave `SECRET_KEY` empty so the key is created inside the `/data` volume), then `docker compose up -d --build`. The image builds on the VPS itself; if you ever build on the Mac for an x86 VPS, add `--platform linux/amd64`.
5. Host cron: nightly `sqlite3 /srv/collected/data/collected.db ".backup /srv/backups/collected-$(date +%F).db"` and delete files older than 14 days. Enable Hetzner weekly snapshots if you want a second copy.

Alternative if you'd rather not run a box: Fly.io with a 1 GB volume. Same Dockerfile, `fly launch`, and cloudflared runs as a second process. Slightly more magic, slightly less flexible for hosting other projects.

If you claim the GitHub Student Developer Pack, DigitalOcean credit makes a 2 GB droplet free for a year. Same steps; pick NYC.

### Cloudflare
1. `https://one.dash.cloudflare.com` → Networks → Tunnels → Create a tunnel → Cloudflared → name `vps`. Copy the install command / token. Run it on the VPS (step 3 above).
2. In the tunnel → Public Hostname → Add: subdomain `collected`, domain `priyamkabra.com`, service `http://localhost:3000`. Cloudflare creates the DNS record. Repeat per project later.
3. Access → Applications → Add an application → Self-hosted. Name `collected`, domain `collected.priyamkabra.com`, session duration 1 month. Policy: name `me`, action Allow, include Emails = your email. Save.
4. Open the application → Overview → copy the **Application Audience (AUD) Tag** into `.env` as `CF_ACCESS_AUD`. Your team domain (`<team>.cloudflareaccess.com`) goes in `CF_ACCESS_TEAM_DOMAIN`. Restart the app.
5. Login methods: one-time PIN to your email works with zero setup and is the fallback. To add Google: Settings → Authentication → Login methods → Add → Google. It needs an OAuth client; reuse the `collected` client from Phase 1 and add `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` as another redirect URI. Then in the Access application, enable Google as an allowed identity provider.

### Google (prod)
The prod redirect URI was added in Phase 1 step 5. After deploy, go to Settings → Sources → Google Calendar → Connect on the prod site once. The refresh token is stored in the prod DB, separate from local.

## Phase 3 — after deploy

- Paste the Canvas cookie into prod (helper takes a `--target https://collected.priyamkabra.com` flag; it sends a service token header that the app checks, since Access will otherwise block a script).
- Enter Gradescope credentials and Todoist token in prod settings.
- Fill in Gradescope course ids and `submits_via` per course.
- Enable the Todoist push sync once the homework section looks right for a day.

## Where the Mac still matters

- The Canvas cookie helper reads Chrome on the Mac. Run it when the Sources widget says Canvas needs auth (should be rare if the ingester keeps polling).
- Later: the resume pipeline (Claude Code + resume skill) runs on the Mac via launchd, pulls matched jobs from the API, posts results back. Neither needs the Mac awake for the dashboard itself to work.
