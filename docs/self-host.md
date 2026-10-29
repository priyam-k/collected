# Self-hosting collected

collected is one Node process in one container: the API, the background sync scheduler, and the built web app, with a SQLite file as the only state. This page takes you from an empty Linux box to a running instance behind HTTPS, with sources connected and backups running. Nothing here assumes you have seen the code.

## What you need

- A Linux machine with Docker and Docker Compose v2 (`docker compose version`). 1 GB of RAM is enough; the app idles under 100 MB and the compose file caps the Node heap at 384 MB.
- A domain or subdomain pointed at that machine (an A/AAAA record), unless you use the Cloudflare Tunnel option below, in which case no DNS record and no open port are needed.
- About 1 GB of disk. The database is a few tens of MB; the job feed is the biggest table.
- A Google Cloud project if you want to sign in with Google or connect Google Calendar through OAuth. Calendar also works without one through the iCal address (step 7).

Everything outbound goes over HTTPS to the sources you connect; the box needs no inbound port except what you open for the web.

## 1. Clone and configure

```sh
git clone https://github.com/priyam-k/collected.git /srv/collected
cd /srv/collected
cp .env.example .env
```

The `data/` directory next to `docker-compose.yml` is the only writable state: `collected.db`, the encryption key `.secret_key`, and pre-migration snapshots. The container runs as the `node` user (uid 1000), so give it ownership once:

```sh
mkdir -p data && sudo chown 1000:1000 data
```

## 2. Environment variables that matter

Open `.env`. Most lines can stay as they are; these are the ones that decide whether the instance works.

| Variable | What it does |
| --- | --- |
| `PUBLIC_URL` | **Required.** The URL people type to reach the app, e.g. `https://collected.example.com`. OAuth redirect URIs and sign-in links are built from it. Compose refuses to start without it. |
| `SECRET_KEY` | Optional. Encrypts stored credentials (Canvas cookie, Gradescope password, Google and Todoist tokens). Leave it **empty** and the app creates `data/.secret_key` on first boot, next to the database it encrypts. Set it to `openssl rand -hex 32` only if you want the key outside the volume. Losing the key means re-entering every credential; it does not lose any data. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. From the OAuth client in step 6. Needed for Google sign-in and for the OAuth Google Calendar source (read and write). Not needed for the iCal calendar source. |
| `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET` | Optional. From a Todoist app (step 7, Todoist). Turns the Todoist card's token box into a "Connect Todoist" button; without them, pasting the API token works as before. |
| `TZ` | The timezone the dashboard thinks in (`America/New_York`, `Europe/Berlin`…). Day boundaries, "due today", and all-day events use it. |
| `AUTH_DISABLED` | Leave `false`. Compose pins it to `false` regardless of `.env`, so a development file copied onto the box cannot switch the login wall off. |

**Sign-in.** The intended flow is Google sign-in: set the two `GOOGLE_*` variables, register the sign-in redirect URI from step 6, and the first person to sign in becomes the owner. Cloudflare Access in front of the app is optional and documented in step 5; if you use it, the app can also verify Access's JWT (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`). Who may sign in: `ALLOWED_EMAILS` (comma-separated) when set; otherwise only the owner.

The rest of `.env.example` is commented inline. `LOCAL_HELPER_KEY` is only for the optional Mac cookie helper; `SEED_CONFIG_PATH` points at an optional first-boot course list.

## 3. Start it

```sh
docker compose pull              # fetches ghcr.io/priyam-k/collected:latest (~110 MB)
docker compose up -d
docker compose logs -f app       # wait for "listening"
docker compose ps                # "healthy" within about a minute
```

The compose file runs the prebuilt image that `.github/workflows/image.yml` publishes on every push to `main`, so nothing is compiled on your box. The image is `linux/amd64`; on an arm64 host (or if you changed the code) build it locally with the override file, which needs about 500 MB of free memory for the web build:

```sh
GIT_SHA=$(git rev-parse --short HEAD) BUILT_AT=$(date -u +%FT%TZ) \
  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

If you run your own fork and publish your own image, change `image:` in `docker-compose.yml` to `ghcr.io/<you>/collected:latest` and set `UPSTREAM_REPO=<you>/collected` in `.env`. GHCR packages start out private: after the first workflow run, open your GitHub profile → Packages → `collected` → Package settings → Change visibility → Public, or `docker compose pull` will be refused with "denied".

The container listens on `127.0.0.1:3000` **only** (see `ports:` in `docker-compose.yml`). Nothing on the network can reach it until you put TLS in front, which is the next step.

Migrations run when the container starts, so code and schema always ship together. The first boot also creates the `data/.secret_key` file and the source rows; five seconds later every enabled source runs once.

## 4. TLS with Caddy

Caddy gets and renews certificates by itself. Install it from your distribution's packages (or [caddyserver.com/docs/install](https://caddyserver.com/docs/install)), then copy [`docs/Caddyfile`](Caddyfile) to `/etc/caddy/Caddyfile`, change the domain on the first line, and reload:

```sh
sudo cp docs/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/collected.example.com/collected.yourdomain.com/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ports 80 and 443 must be reachable from the internet for the certificate to issue (`ufw allow 80,443/tcp` if you run a firewall). After that, `https://collected.yourdomain.com` serves the app. The Caddyfile reverse-proxies to `127.0.0.1:3000`, which is the loopback-only port the compose file publishes, so the app itself is never exposed without TLS.

If you prefer nginx or Traefik, the only requirements are: terminate TLS, forward to `127.0.0.1:3000`, pass `Host` and `X-Forwarded-Proto` through, and allow request bodies up to a few MB (the config import).

## 5. Optional: Cloudflare Tunnel and Access

If the machine cannot accept inbound connections (home network, campus wifi, a friend's box), a Cloudflare Tunnel replaces step 4. `cloudflared` on the box opens outbound connections to Cloudflare; your hostname points at the tunnel; TLS terminates at Cloudflare's edge. No open port, no certificate to manage, no Caddy.

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Name it, copy the token.
2. On the box: `curl -fsSL https://pkg.cloudflare.com/install.sh | sudo bash && sudo apt install cloudflared` (or your distribution's package), then `sudo cloudflared service install <token>`. It runs as a systemd service and dials out.
3. In the tunnel → Public Hostname → Add: your subdomain and domain, service `http://localhost:3000`. Cloudflare creates the DNS record.

Set `PUBLIC_URL=https://<that hostname>` in `.env` and restart (`docker compose up -d`).

**Access** (optional login wall in front of the app): Zero Trust → Access → Applications → Add → Self-hosted, the same hostname, a policy that allows your email. Open the application's Overview and copy the Application Audience (AUD) tag into `.env` as `CF_ACCESS_AUD`; your team domain (`<team>.cloudflareaccess.com`) goes in `CF_ACCESS_TEAM_DOMAIN`. With both set, the app verifies Access's signed JWT on every API request, so even a mistake in the tunnel configuration cannot expose the API. The CLI identifies itself to the app with an API token from `collected login` (Settings → Account). With Access in front, the CLI additionally needs an Access service token to get past the edge: create one under Access → Service Auth, attach it with a Service Auth policy, and store it with `collected auth service-token <id>`.

## 6. Google OAuth client

Needed for Google sign-in, the OAuth Google Calendar source and Google Tasks on a server. Skip it if you will use the iCal calendar address and another sign-in method. The CLI's local mode (step 10) needs none of this: the `collected-cli` package carries a Google client of the "Desktop app" kind, which accepts any loopback redirect, so `collected connect google` and the Connect buttons in `collected ui` work without a project; `~/.collected/.env` takes your own `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` if you prefer (the CLI [README](../agent/README.md#collectedenv-overrides-for-local-mode)).

1. [console.cloud.google.com](https://console.cloud.google.com) → New project (any name, e.g. `collected`).
2. APIs & Services → Library → enable **Google Calendar API**, and **Google Tasks API** if you will connect Google Tasks.
3. APIs & Services → OAuth consent screen (Google now calls it "Google Auth Platform → Branding/Audience"): User type **External**. App name, your email as support and developer contact. Scopes → Add:
   - `openid`, `email`, `profile` (sign-in)
   - `https://www.googleapis.com/auth/calendar.readonly` (list calendars, read events)
   - `https://www.googleapis.com/auth/calendar.events` (create events from the dashboard's quick-add)
   - `https://www.googleapis.com/auth/tasks` (Google Tasks: read your lists, add and complete tasks). Asked for only when you click Connect Google Tasks, as a separate consent; connecting Calendar never asks for it.
4. **Publishing status must be "In production".** In "Testing" status Google expires every refresh token after seven days, and the Calendar connection silently dies until you reconnect. Click Publish app; you do not need to complete verification for a personal instance. Google will show a "this app isn't verified" screen the first time each user connects: Advanced → Go to collected. That warning appears once per user, not on every sign-in.
5. Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URIs, with your real domain:
   - `https://<your-domain>/api/auth/google/callback` (sign-in)
   - `https://<your-domain>/api/google/callback` (Google Calendar and Google Tasks connect; one URI for both)
   For local development add the same two paths on `http://localhost:5173`.
6. Copy the client id and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then `docker compose up -d` to restart with the new environment.

The Calendar scopes are used only to show your events on the board and to create the events you add from it. Nothing is sent anywhere else; the privacy page in the app spells this out.

## 7. Connecting sources

Sign in, then open Settings → Sources. Every source can be enabled, disabled, and re-synced from there, and the Sources widget on the board shows each one's status.

- **Canvas**: Canvas has no API tokens for students at most schools, so the app uses your browser session cookie. On a laptop with the CLI installed (step 10), run `collected connect canvas`; it reads the cookie from your browser and posts it to the server over HTTPS. The fallback is manual: DevTools → Application → Cookies → your Canvas domain, paste the cookie header into the form. Also paste the Canvas calendar feed URL (Canvas → Calendar → Calendar Feed) as the iCal fallback, which keeps due dates flowing while the cookie is expired. The cookie is encrypted at rest and re-polled every 15 minutes.
- **Gradescope**: email and password of a native Gradescope login (not the school SSO button; set a password from Gradescope's account settings if you only ever used SSO). Then set each course's Gradescope course id (the number in the course URL) under Settings → Courses.
- **Todoist**, two ways:
  - *API token*: Todoist → Settings → Integrations → Developer → API token, pasted into the card.
  - *Connect Todoist* (OAuth, optional): register a Todoist app once at `https://developer.todoist.com/appconsole.html` (free; no organisation or paid plan). Create a new app, name it `collected`, and set its **OAuth redirect URL** to `https://<your-domain>/api/todoist/callback`. Copy the Client ID and Client secret into `.env` as `TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET`, `docker compose up -d`, and the Todoist card shows Connect Todoist. The consent screen asks for `data:read_write,data:delete`; delete is needed so the push sync can remove a task it created when the assignment disappears at the source. Disconnect clears the token here and revokes it at Todoist. The paste form stays available under "or paste an API token".

  Push sync (creating Todoist tasks for assignments) is off by default and configured under Settings → To-do apps → Todoist, whichever way you connected.
- **Google Tasks**: with the client from step 6 configured and the Tasks API enabled, click Connect Google Tasks. It is its own consent screen asking only for the tasks scope, so a Calendar connection is untouched. Every list is read; tasks from both Todoist and Google Tasks appear in the to-do widget, and Settings → To-do apps → "Add new tasks to" picks where the add-task box sends. The assignment push works here too: Settings → To-do apps → Google Tasks → enable, pick the list name (default `School`, created if missing) and whether titles carry the course code (`[CMSC422] HW3`). Google Tasks has no time of day, so the task is due on the assignment's day in your timezone and the time is in the notes. It follows the same rules as the Todoist push (one-way, never reopens, never writes to Canvas or Gradescope, deletes fused) and keeps its own mapping, so both pushes can be on at once while you move from one app to the other; turn the old one off when you are done or you will have two mirrors of every assignment. Preview from the box with `pnpm cli push gtasks --dry-run`.
- **Google Calendar**, two ways:
  - *OAuth* (read and write): with the client from step 6 configured, click Connect Google Calendar, pick which calendars to show and which one new events go to.
  - *Secret iCal address* (read-only, no Google Cloud project): in Google Calendar on the web, Settings (gear) → the calendar under "Settings for my calendars" → Integrate calendar → **Secret address in iCal format**. Paste it into the "Google Calendar (iCal)" card. It refreshes every 30 minutes, covers two weeks back and sixty days ahead, and expands recurring events. One address per calendar; treat the URL like a password (anyone holding it can read that calendar), which is why it is stored encrypted and never shown again.
- **Job feed**: public JSON listings, no credentials. Tune the filter under Settings → Jobs.

Each source runs on its own timer (Canvas 15 min, Gradescope 30, Google Calendar, Google Tasks and Todoist 5, iCal and jobs 60). A failed fetch marks that one source `error` or `needs auth` on the board and never deletes what was already pulled.

## 8. Backups

The whole state is `data/collected.db` plus `data/.secret_key`. `scripts/backup.sh` writes a consistent single-file copy (via `sqlite3 .backup`, or `VACUUM INTO` through the container when `sqlite3` is not installed on the host) to `backups/collected-YYYY-MM-DD.db.gz`, copies the key to `backups/secret_key` the first time, and deletes dumps older than 14 days.

Nightly, as the user that owns the checkout (`crontab -e`):

```
10 4 * * * cd /srv/collected && DATA_DIR=/srv/collected/data BACKUP_DIR=/srv/collected/backups sh scripts/backup.sh >> /srv/collected/backups/backup.log 2>&1
```

Check it the next morning: `ls -la backups/` and `gunzip -t backups/collected-*.db.gz`. For an off-box copy set `BACKUP_BUCKET=gs://bucket/prefix` (uses `gcloud storage cp`) or `BACKUP_RCLONE_REMOTE=<remote>` plus `BACKUP_BUCKET=<path>` (uses `rclone copyto`) in the cron line. The key is never uploaded on purpose: a dump without it has every credential encrypted and unreadable. Put `backups/secret_key` in your password manager once.

**Restore** (new box, or undoing a bad upgrade):

```sh
docker compose down
gunzip -c backups/collected-2026-10-26.db.gz > data/collected.db
rm -f data/collected.db-wal data/collected.db-shm
cp backups/secret_key data/.secret_key && chmod 600 data/.secret_key
sudo chown 1000:1000 data/collected.db data/.secret_key
docker compose up -d
```

The app writes `data/backups/pre-<migration>-<timestamp>.db` before applying a migration (the three newest are kept); to roll back a migration, restore that file and start the previous image.

## 9. Updating

The app checks for updates itself: thirty seconds after boot and every six hours it asks GitHub how far upstream `main` is ahead of the commit it is running (one unauthenticated request to `api.github.com`, carrying nothing but the commit sha). When something changed that affects the running app, a banner on the board names the new changelog entries and these commands:

```sh
cd /srv/collected
git pull --ff-only
docker compose pull
docker compose up -d
```

`git pull` brings the compose file and scripts up to date, `pull` fetches the new image, `up -d` replaces the container in place; the `data/` volume carries over. `docker compose logs -f app` afterwards: "migrations applied" names any pre-migration snapshot it wrote. Changes that only touch documentation do not raise the banner. Settings → About shows the running version and commit, the last check, and a button to check now; `curl -s http://127.0.0.1:3000/api/health` on the box prints the version without signing in.

`UPDATE_CHECK_DISABLED=true` in `.env` switches the check off entirely (no request is made). `UPSTREAM_REPO=<you>/collected` points it at your fork; if that fork is private, add `UPDATE_CHECK_TOKEN=<fine-grained token with Contents: read>` or the check reports the commit as unknown. An image built locally without `GIT_SHA` reports the commit `dev` and the check says it has nothing to compare.

If the new version fails its health check, `docker compose logs app` says why. The previous image is still local (`docker images`): `docker tag <old image id> ghcr.io/priyam-k/collected:latest && docker compose up -d --pull never` is the rollback. `scripts/deploy.sh` automates this (backup, load a new image, promote, health check, roll back on failure) for setups that build the image elsewhere.

## 10. The CLI

`collected` is a command-line client for the dashboard: read your agenda, courses, grades, and announcements; add tasks and dates; and the file-sync agent that mirrors course files into local folders on your laptop. AI agents on your machine can use it the same way you do.

```sh
npm i -g collected-cli
collected init https://collected.yourdomain.com
collected login                      # opens the browser, stores a token in ~/.collected/agent.json (mode 600)
collected agenda                     # try it
collected help                       # every command
```

`collected connect canvas` posts your Canvas session cookie to the server (step 7). `collected files link <course-id> ~/school/<course>` and `collected sync` set up the file sync; `collected install-launchd --interval 30` keeps it running on a Mac. The config file holds the server URL and the token; the server never learns a filesystem path, and the agent never overwrites or removes a file whose bytes changed since it placed it.

If you are deploying from a checkout rather than npm, `pnpm --filter collected-cli build` produces `agent/dist/cli.js`; alias `collected` to `node <checkout>/agent/dist/cli.js`.

**Or run it on your laptop.** None of the above is required to use collected: `collected init --local` keeps the whole backend inside the CLI, over a SQLite database in `~/.collected/data`, with no server, Docker, domain or OAuth client. `collected ui` serves the same dashboard at `http://127.0.0.1:4848` for this machine only, with no sign-in, and keeps the sources syncing while it is open; `collected daemon install` adds a user-level timer (LaunchAgent on macOS, systemd user timer on Linux) that syncs every 15 minutes whether or not the dashboard is open, and a plain `collected agenda` syncs a stale source before it answers. The npm package carries everything local mode needs, the dashboard included, so `npm i -g collected-cli` on a machine with Node 22.12+ is the whole install. Google Calendar and Google Tasks connect with `collected connect google [tasks]` or from Settings → Sources in `collected ui`, with no Google Cloud project of your own (step 6). What you give up next to a server: access from another device, and Sign in with Todoist unless you register a Todoist app yourself (a pasted token works). See the CLI's [README](../agent/README.md#install) and, for what the package ships and how it is tested before publishing, [releasing.md](releasing.md#what-the-package-is).

## Troubleshooting

- `Invalid environment:` at startup names the variable to fix.
- `set PUBLIC_URL in .env`: compose refuses to start without it.
- A source shows `needs auth` with "encrypted with a different SECRET_KEY": the key file and the database no longer match (usually a restore that forgot `.secret_key`). Restore the key, or re-enter the credential.
- The health probe (`/api/health`) is the one route that needs no login; `curl -s http://127.0.0.1:3000/api/health` on the box tells you whether the app is up before you suspect the proxy.
- Logs are JSON on stdout: `docker compose logs --since 1h app | grep '"level":50'` shows errors.
