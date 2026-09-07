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

or by hand: Chrome DevTools → Application → Cookies → `umd.instructure.com` → copy `canvas_session` (older Canvas instances call it `_normandy_session`; either works) into Settings → Sources → Canvas. Also paste the iCal feed URL from Canvas → Calendar → Calendar Feed, for the fallback.

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

### Where to run it (pick one)

Everything runs in one container: API, scheduler, and the built frontend. State is the `/data` volume (SQLite + key file). `cloudflared` is the only other process. Needs ~250 MB RAM, negligible CPU, under 1 GB disk, and a few MB of egress a day. Nothing needs an open inbound port. Moving between boxes = `docker compose up` on the new one and copying the `data/` directory.

| Option | Cost | Notes |
|---|---|---|
| **Google Cloud e2-micro (Always Free)** | $0 | 1 GB RAM, 30 GB disk, 1 GB egress/month, only in `us-east1` / `us-central1` / `us-west1`. Needs a card on file. Add 1 GB swap. The best free option for this workload. |
| **GitHub Student Pack → DigitalOcean credit** | $0 for a year, then ~$6/mo | Simplest UI. 1 GB droplet in NYC. |
| **A friend's always-on box** | $0 | Tunnel makes this trivial: Docker + outbound internet is all it needs. Ask for a user account with Docker access. |
| **Oracle Cloud Always Free ARM** | $0 | 2 OCPU / 12 GB as of mid-2026, far more than needed. Signup is flaky and idle instances get reclaimed unless you upgrade to pay-as-you-go (still free within limits). Build the image on the box (arm64). |
| **Hetzner Cloud, EU location** | ~€4–5/mo | US locations tripled in price in 2026; Falkenstein/Helsinki CX plans are still cheap. Extra ~100 ms latency is irrelevant behind Cloudflare for one user. |
| **Railway / Fly.io** | ~$5/mo | Dockerfile + volume both work; no free tier any more. |
| **Your Mac** | $0 | Works through the tunnel whenever the lid is open; ingesters miss runs while asleep. Fine as a stopgap. |
| **Cloudflare Workers + D1** | $0–5/mo | Would need a port: Node-only pieces (googleapis, pino, cookie jar, scheduler) replaced, and the free tier's daily D1 write cap is smaller than one hourly job sync. Not worth it until something else forces a rewrite. |

### Google Cloud e2-micro, step by step

Same Google Cloud project as the OAuth client is fine; the free tier is per billing account, not per project.

1. Console → select the `collected` project → **Billing** → link a billing account (needs a card; new accounts also get trial credit). Compute Engine won't create VMs without billing enabled, but the Always Free discount is applied on the invoice.
2. **APIs & Services → Library → Compute Engine API → Enable.**
3. **Compute Engine → VM instances → Create instance.** Name `collected`. Region `us-east1` (any zone). Machine: series **E2**, type **e2-micro**. Boot disk → Change: **Ubuntu 24.04 LTS (x86/64)**, disk type **Standard persistent disk** (not Balanced), size **30 GB**. Leave firewall boxes unchecked (nothing inbound is needed). The newer Console wizard adds several more pages before Create — none change the price except one:
   - **Backups**: defaults to a **Snapshot schedule**, which bills for snapshot storage (small, but not $0). Switch to **No backups** — the nightly `sqlite3 .backup` in Phase 2 already covers what actually matters.
   - **Networking / Network performance**: leave every default (no HTTP/HTTPS firewall rules, Tier_1 networking bandwidth unchecked, default NIC). All free.
   - **Observability**: Ops Agent checked is fine to leave on — Cloud Logging/Monitoring's own free allowance (50 GiB logs/month) is far more than one low-traffic personal VM produces.
   - **Security / Confidential VM / Shielded VM / Advanced / Metadata**: defaults are all free (default service account, Confidential VM disabled, vTPM + Integrity Monitoring on, no deletion protection, Google-managed encryption key). Nothing to change.

   Create. Ignore the cost estimate panel (it'll show a few dollars a month, e.g. "2 vCPU + 1 GB memory") — that's e2-micro's normal burst spec priced without the Always Free discount, which the estimator doesn't know about.
   The free allowance is one e2-micro's worth of hours per month in `us-west1` / `us-central1` / `us-east1`, 30 GB of standard disk, 1 GB egress per month. Anything else on the account bills normally.
4. Click **SSH** in the console (browser terminal) for this first session — it's enough to run the block below. Browser SSH can drop the connection if you tab away for a while; if it disconnects mid-`curl`, just reopen SSH and re-run the block (the swap lines are safe to repeat; `swapon --show` confirms if swap already succeeded). For every session after this one, prefer a real terminal: `gcloud compute ssh <instance-name>` (e.g. `gcloud compute ssh collected`) — the instance name is required but the zone usually isn't, since gcloud looks it up as long as the name is unique across your zones; first run auto-generates an SSH key and pushes it to the instance's metadata, no manual setup. Set a default zone once (`gcloud config set compute/zone <zone>`) to skip any zone prompt entirely, or always pass `--zone=<zone>` if you'd rather be explicit.

   ```sh
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker
   sudo mkdir -p /srv/collected && sudo chown $USER /srv/collected
   ```
5. Get the code onto the box. Same repo as local — `.gitignore` already excludes `.env`, `data/`, `node_modules`, and `*.db`, so cloning it brings no secrets along. Recommended: a deploy key, an SSH keypair scoped to just this repo (read-only, doesn't touch your GitHub account), generated on the VM:
   ```sh
   ssh-keygen -t ed25519 -C "collected-vm" -f ~/.ssh/collected_deploy -N ""
   cat ~/.ssh/collected_deploy.pub
   ```
   Copy that into GitHub → the repo → **Settings → Deploy keys → Add deploy key**, leave "Allow write access" unchecked. Then point git at it and clone:
   ```sh
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     IdentityFile ~/.ssh/collected_deploy
     IdentitiesOnly yes
   EOF
   chmod 600 ~/.ssh/config
   git clone git@github.com:priyam-k/collected.git /srv/collected
   ```
   (Clones straight into `/srv/collected`, which already exists and is owned by you — don't `mkdir` it again first.) Future updates are just `git pull` on the box. `gh auth login` is the alternative if the box will need broader GitHub access later, but it authenticates your whole account rather than one repo, so it's more than this single-purpose VM needs.

   Without GitHub at all: `rsync -az --exclude node_modules --exclude data --exclude .env ./ collected-vm:/srv/collected/` from the Mac — no key setup, but no real git history on the box either, and every future update means re-running it by hand.
6. `cd /srv/collected && cp .env.example .env` and set `AUTH_DISABLED=false`, `PUBLIC_URL=https://collected.priyamkabra.com`, `GOOGLE_CLIENT_ID/SECRET`, `TZ`; the Cloudflare values come from the next section. Leave `SECRET_KEY` empty.
7. `docker compose up -d --build`. The build is slow on 1 GB RAM (several minutes) but the swap keeps it alive. If it dies anyway, build on the Mac instead and ship the image:
   ```sh
   docker build --platform linux/amd64 -t collected:latest .
   docker save collected:latest | gzip | ssh collected-vm 'gunzip | docker load'
   ssh collected-vm 'cd /srv/collected && docker compose up -d'
   ```
   (`docker-compose.yml` names the image `collected:latest`, so compose will use the loaded one instead of rebuilding.)
8. `docker compose logs -f app` should show `seeded from seed-config.json` and `listening`. Then do the Cloudflare section.

### How the tunnel works

Normally exposing a server means an open port, a public IP, and DNS pointing at it. Cloudflare Tunnel inverts that: `cloudflared` on the box opens a few **outbound** connections to Cloudflare's nearest data centers and keeps them alive. Your DNS record for `collected.priyamkabra.com` points at the tunnel, not at any IP. A browser request lands on Cloudflare's edge, TLS terminates there, Cloudflare Access checks the login, and the request travels down the already-open connection to `cloudflared`, which forwards it to `http://localhost:3000` on the box. The box never accepts an inbound connection, so it works behind NAT, dorm wifi, campus firewalls, or a friend's home router with no port forwarding, no static IP, and no certificates to manage. The connector proves it is yours with the tunnel token; Access adds the "only Priyam" layer and signs a JWT the app verifies on every request.

**On a friend's box**: nothing on their network changes. They give you a user account with Docker access; you run the container and `cloudflared service install <your token>` there. The tunnel, hostname, and login policy all live in your Cloudflare account; `cloudflared` only forwards to the one local port you configured, so nothing else on their machine is reachable through it, and their IP never appears anywhere. If they already run `cloudflared` for their own domain, a second connector with your token runs alongside it. The trust question is the other direction: whoever has root on that box can read the `data/` volume (your Canvas cookie, tokens, key file).

### VPS (Hetzner or any Ubuntu box)
1. Any Ubuntu 24.04 box works. Hetzner: `https://console.hetzner.cloud` → new project → Add server, a Falkenstein/Helsinki CX plan is the cheap one. Google Cloud: Compute Engine → Create instance → e2-micro in `us-east1`, Ubuntu 24.04, 30 GB standard disk, then `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` and add it to `/etc/fstab`. Either way: add your SSH key, firewall inbound 22 only. Nothing else needs to be open; the tunnel is outbound.
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
