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
- **Browser**: keep Canvas logged in in Chrome (or Brave/Edge/Arc/Chromium/Firefox); `collected connect canvas` reads that cookie.

## Phase 1 — during development, as each ingester lands

All of these are entered in the app's Settings page (or `.env` for the Google client), locally first.

### Todoist
Paste the API token into Settings → Sources → Todoist.

### Canvas
Build the `collected` CLI once (`pnpm --filter agent build`, then `collected init http://localhost:3000` and `collected auth helper-key <LOCAL_HELPER_KEY>`; see "Laptop agent" below). Then let it read the cookie from your browser and post it to the running app:

```sh
collected connect canvas              # reads the default browser, posts to the server in agent.json
collected connect canvas --dry-run    # just list which browser/profile and cookie names were found
collected connect canvas --browser arc   # chrome | brave | edge | arc | chromium | firefox
```

It reads the session cookie out of the browser's own cookie store (decrypting Chromium's Keychain-encrypted store). **macOS will ask for your Keychain password — click "Allow", not "Always Allow".** Only the session cookies are sent, over the https (or localhost) server URL.

Or by hand: Chrome DevTools → Application → Cookies → `umd.instructure.com` → copy `canvas_session` (older Canvas instances call it `_normandy_session`; either works) into Settings → Sources → Canvas. Also paste the iCal feed URL from Canvas → Calendar → Calendar Feed, for the fallback.

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
   - `https://collected.example.com/api/google/callback`
   and the same three with `/api/auth/google/callback` (sign-in; identity only, no Calendar scopes). The consent screen's publishing status must be **In production**: in Testing, Google expires refresh tokens after seven days, which silently disconnects the calendar.
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
   - **Backups**: defaults to a **Snapshot schedule**, which bills for snapshot storage (small, but not $0). Keep it until the nightly `scripts/backup.sh` cron in step 10 has produced a dump you have restored from once; after that it is optional (the dump plus `.secret_key` is the whole state).
   - **Networking / Network performance**: leave every default (no HTTP/HTTPS firewall rules, Tier_1 networking bandwidth unchecked, default NIC). All free.
   - **Observability**: **uncheck Ops Agent.** Its two collectors (`otelopscol`, `fluent-bit`) hold ~80 MB RAM and a few percent CPU permanently, which is real money on a 1 GB box that already swaps. If it's already installed, turn it off:
     ```sh
     sudo systemctl disable --now google-cloud-ops-agent google-cloud-ops-agent-opentelemetry-collector google-cloud-ops-agent-fluent-bit
     ```
   - **Security / Confidential VM / Shielded VM / Advanced / Metadata**: defaults are all free (default service account, Confidential VM disabled, vTPM + Integrity Monitoring on, no deletion protection, Google-managed encryption key). Nothing to change.

   Create. Ignore the cost estimate panel (it'll show a few dollars a month, e.g. "2 vCPU + 1 GB memory") — that's e2-micro's normal burst spec priced without the Always Free discount, which the estimator doesn't know about.
   The free allowance is one e2-micro's worth of hours per month in `us-west1` / `us-central1` / `us-east1`, 30 GB of standard disk, 1 GB egress per month. Anything else on the account bills normally.
   Know what you're getting: e2-micro is a shared-core VM (0.25 vCPU sustained, bursts to 2) and a 30 GB *standard* persistent disk does roughly 45 write IOPS and 3 MB/s. Anything that fsyncs per row crawls, and swapping onto that disk stalls the whole box, cloudflared included. The app is written for it (batched writes, WAL with `synchronous=NORMAL`, a 384 MB V8 heap cap in compose), but keep other processes off the box.
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
   git clone git@github.com:<you>/collected.git /srv/collected
   ```
   (Clones straight into `/srv/collected`, which already exists and is owned by you — don't `mkdir` it again first.) Future updates are just `git pull` on the box. `gh auth login` is the alternative if the box will need broader GitHub access later, but it authenticates your whole account rather than one repo, so it's more than this single-purpose VM needs.

   Without GitHub at all: `rsync -az --exclude node_modules --exclude data --exclude .env ./ collected-vm:/srv/collected/` from the Mac — no key setup, but no real git history on the box either, and every future update means re-running it by hand.
6. `cd /srv/collected && cp .env.example .env` and set `PUBLIC_URL=https://collected.example.com` (required: `docker compose` refuses to start without it), `GOOGLE_CLIENT_ID/SECRET`, `TZ`; the Cloudflare values come from the next section. Leave `SECRET_KEY` empty. `AUTH_DISABLED` is pinned to `false` in `docker-compose.yml` and cannot be switched on from `.env` in a container; the container also runs with a read-only root filesystem, no capabilities and `no-new-privileges` (only `/data` and `/tmp` are writable).
   Then create the data directory owned by the container's user: `mkdir -p data && sudo chown 1000:1000 data`. The image runs as `node` (uid 1000) and the bind mount in `docker-compose.yml` replaces the ownership baked into the image; skip this and the app crash-loops with `EACCES: permission denied, open '/data/.secret_key'`. (On Ubuntu images uid 1000 is the `ubuntu` account, which is why the files show up as owned by `ubuntu`.)
7. Build the image on the Mac and ship it. The box cannot build it: `tsc` plus Vite need ~500 MB and on 1 GB with a 0.25-vCPU share the build sat in `tsc` for 15 minutes, swapped the box into the ground, and took SSH down with it (2026-09-07). From the repo on the Mac:
   ```sh
   pnpm -r typecheck                                   # the image build skips tsc on purpose; check here
   docker build --platform linux/amd64 -t collected:latest .
   docker save collected:latest | gzip -1 > /tmp/collected.tar.gz   # ~110 MB
   gcloud compute scp /tmp/collected.tar.gz <instance>:/tmp/ --zone <zone>
   gcloud compute ssh <instance> --zone <zone> --command \
     'gunzip -c /tmp/collected.tar.gz | docker load && cd /srv/collected && docker compose up -d'
   ```
   Upload takes under a minute. `docker-compose.yml` names the image `ghcr.io/priyam-k/collected:latest` (the one `.github/workflows/image.yml` publishes on every push to `main`), so a loaded tarball must carry that tag: `docker tag collected:latest ghcr.io/priyam-k/collected:latest` on the box before `up -d` (`scripts/deploy.sh` does this), or simply `docker compose pull && docker compose up -d` once the image is public on GHCR. Building locally goes through the override file, `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`, never on the box. Pass `--build-arg GIT_SHA=$(git rev-parse --short HEAD)` to a hand-run `docker build` or the server reports the commit `dev` and the self-host update check (`/api/system/update`, DECISIONS 047) has nothing to compare. If Docker Desktop's registry hang bites, the base image `node:24-bookworm-slim` is already cached locally for amd64 after the first successful build.
8. `docker compose logs -f app` should show `seeded from seed-config.json` and `listening`, and `docker compose ps` should say `healthy` within about a minute (the health probe is the one API route that doesn't need an Access JWT). Five seconds after boot every ingester runs once; the jobs feed is ~16k rows and its first run writes them all, later runs write only what changed. Then do the Cloudflare section.
9. Updating later: push to `main`. `.github/workflows/deploy.yml` does step 7 on a GitHub runner (typecheck and tests first, then build, tarball, scp, `git pull` on the box, `docker load`, `compose up`, wait for `/api/health`). One-time setup, from the Mac:
   ```sh
   # a keypair only Actions uses
   ssh-keygen -t ed25519 -C github-actions-deploy -f ~/.ssh/gha_deploy -N ""
   # public half into the instance's ssh-keys metadata; the guest agent installs it. Don't edit authorized_keys by hand on GCP: the agent rewrites it.
   cur=$(gcloud compute instances describe <instance> --zone <zone> --format='value(metadata.items.filter(key:ssh-keys).extract(value).flatten())')
   printf '%s\n%s\n' "$cur" "<user>:$(cat ~/.ssh/gha_deploy.pub)" > /tmp/ssh-keys.txt
   gcloud compute instances add-metadata <instance> --zone <zone> --metadata-from-file ssh-keys=/tmp/ssh-keys.txt
   # what the workflow reads
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/gha_deploy
   gh secret set DEPLOY_HOST --body "$(gcloud compute instances describe <instance> --zone <zone> --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
   gh secret set DEPLOY_USER --body <user>
   # the box's SSH host key, pinned by the workflow so nothing can impersonate the box
   gh secret set DEPLOY_HOST_KEY --body "$(ssh-keyscan -t ed25519 <ip> 2>/dev/null)"
   # the one repository allowed to run the deploy job; forks build but never deploy
   gh variable set DEPLOY_REPO --body <you>/collected
   # these used to be repository *variables*; secrets are masked in the (public, once the repo is) workflow logs
   gh variable delete DEPLOY_HOST && gh variable delete DEPLOY_USER
   ```
   Then two things in the GitHub UI, once: **Settings → Environments → New environment** `production`, add yourself as a required reviewer (the `deploy` job waits for a click; the `build` job runs unattended and has no secrets), and **Settings → Branches → Add rule** for `main` (require a pull request, require the `ci` check). Anyone who can push to `main` deploys to the box, so `main` should not take direct pushes. Pull requests and other branches run `.github/workflows/ci.yml` (typecheck, tests, `pnpm audit`) with no secrets.

   The box's host key is pinned through the `DEPLOY_HOST_KEY` secret; if the box is ever rebuilt, set it again from the output of `ssh-keyscan -t ed25519 <ip>`. The external IP is ephemeral (no reserved address): stopping and starting the instance changes it, so update `DEPLOY_HOST` then, or reserve the current one with `gcloud compute addresses create collected-ip --addresses <ip> --region us-east1` (check GCP's current static-IPv4 pricing first; it is no longer free).

   What the deploy does on the box (`scripts/deploy.sh`): runs `scripts/backup.sh`, loads the new image as `collected:candidate`, tags the running `collected:latest` as `collected:prev`, promotes the candidate to `latest`, `docker compose up -d`, waits up to three minutes for `/api/health`. If that fails it tags `prev` back to `latest`, restarts, and the workflow fails with `ROLLED BACK` in the log. A rollback does not undo a schema migration: the app writes `data/backups/pre-<migration>-<timestamp>.db` (the three newest are kept) before applying anything, and the `migrations applied` log line names it; see "Restore" in step 10. Manual rollback is the same two commands: `docker tag collected:prev collected:latest && docker compose up -d`. Step 7 by hand still works as a fallback (tag the image `collected:candidate` and run `sh scripts/deploy.sh /tmp/collected.tar.gz`). Never `--build` on the box.
10. Backups. `scripts/backup.sh` writes a consistent copy of the database to `/srv/collected/backups/collected-YYYY-MM-DD.db.gz` (via `sqlite3 .backup`, or `VACUUM INTO` through the app container when `sqlite3` is not installed, which it is not on the box), copies `data/.secret_key` to `backups/secret_key` the first time, and deletes dumps older than 14 days. The deploy runs it before every restart; cron runs it nightly. On the box, `crontab -e`:
    ```
    # nightly 04:10 local; stdout/stderr to a log the box keeps
    10 4 * * * cd /srv/collected && sh scripts/backup.sh >> /srv/collected/backups/backup.log 2>&1
    ```
    Verify it the next morning (`ls -la /srv/collected/backups`, `gunzip -t` the newest file). Off-box copy: set `BACKUP_BUCKET=gs://<bucket>/collected` in the cron line and the dump is also `gcloud storage cp`'d there (the VM's default service account needs Storage Object Creator on the bucket; a bucket with a 30-day lifecycle rule stays within the free 5 GB). With `BACKUP_RCLONE_REMOTE=<remote>` it uses `rclone copyto` instead. The key is never uploaded: put `backups/secret_key` in your password manager by hand, once. A dump without the key has every credential encrypted and unreadable, which is what you want from a bucket, and useless to you, which is why the key needs its own home.

    **Restore** (new box, or undoing a bad migration): `docker compose down`, `gunzip -c backups/collected-<date>.db.gz > data/collected.db` (or `cp data/backups/pre-<migration>-<stamp>.db data/collected.db` for the pre-migration snapshot), `rm -f data/collected.db-wal data/collected.db-shm`, make sure `data/.secret_key` is the key that encrypted that database (`cp backups/secret_key data/.secret_key && chmod 600 data/.secret_key`), `sudo chown 1000:1000 data/collected.db data/.secret_key`, then start the image that matches the schema (`docker tag collected:prev collected:latest` if you are undoing a migration) and `docker compose up -d`. The app re-fetches everything else from its sources on boot.

### How the tunnel works

Normally exposing a server means an open port, a public IP, and DNS pointing at it. Cloudflare Tunnel inverts that: `cloudflared` on the box opens a few **outbound** connections to Cloudflare's nearest data centers and keeps them alive. Your DNS record for `collected.example.com` points at the tunnel, not at any IP. A browser request lands on Cloudflare's edge, TLS terminates there, Cloudflare Access checks the login, and the request travels down the already-open connection to `cloudflared`, which forwards it to `http://localhost:3000` on the box. The box never accepts an inbound connection, so it works behind NAT, dorm wifi, campus firewalls, or a friend's home router with no port forwarding, no static IP, and no certificates to manage. The connector proves it is yours with the tunnel token; Access adds the "only you" layer and signs a JWT the app verifies on every request.

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
4. `git clone` into `/srv/collected`, copy `.env.example` → `.env`, fill it (`AUTH_DISABLED=false`, `PUBLIC_URL=https://collected.example.com`, the Cloudflare and Google values from below; leave `SECRET_KEY` empty so the key is created inside the `/data` volume), then `docker compose pull && docker compose up -d`: the compose file runs the prebuilt `ghcr.io/priyam-k/collected:latest`. To build on the VPS itself (2 GB or more): `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`; if you ever build on the Mac for an x86 VPS, add `--platform linux/amd64`.
5. Host cron: nightly `cd /srv/collected && BACKUP_DIR=/srv/backups sh scripts/backup.sh` (see the GCP section, step 10, for what it does and how to restore). Enable Hetzner weekly snapshots if you want a second copy.

Alternative if you'd rather not run a box: Fly.io with a 1 GB volume. Same Dockerfile, `fly launch`, and cloudflared runs as a second process. Slightly more magic, slightly less flexible for hosting other projects.

If you claim the GitHub Student Developer Pack, DigitalOcean credit makes a 2 GB droplet free for a year. Same steps; pick NYC.

### Cloudflare
1. `https://one.dash.cloudflare.com` → Networks → Tunnels → Create a tunnel → Cloudflared → name `vps`. Copy the install command / token. Run it on the VPS (step 3 above).
2. In the tunnel → Public Hostname → Add: subdomain `collected`, domain `example.com`, service `http://localhost:3000`. Cloudflare creates the DNS record. Repeat per project later.
3. Access → Applications → Add an application → Self-hosted. Name `collected`, domain `collected.example.com`, session duration 1 month. Policy: name `me`, action Allow, include Emails = your email. Save.
4. Open the application → Overview → copy the **Application Audience (AUD) Tag** into `.env` as `CF_ACCESS_AUD`. Your team domain (`<team>.cloudflareaccess.com`) goes in `CF_ACCESS_TEAM_DOMAIN`. Restart the app.
5. Login methods: one-time PIN to your email works with zero setup and is the fallback. To add Google: Settings → Authentication → Login methods → Add → Google. It needs an OAuth client; reuse the `collected` client from Phase 1 and add `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback` as another redirect URI. Then in the Access application, enable Google as an allowed identity provider.

### Google (prod)
The prod redirect URI was added in Phase 1 step 5. After deploy, go to Settings → Sources → Google Calendar → Connect on the prod site once. The refresh token is stored in the prod DB, separate from local.

## Sign-in (DECISIONS 044)

The app signs people in itself with Google (identity only). With `GOOGLE_CLIENT_ID/SECRET` set and the `/api/auth/google/callback` redirect URI registered, the first person to sign in becomes the owner; nobody else can sign in unless `ALLOWED_EMAILS` lists them. Cloudflare Access (Phase 2) is optional on top: when `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, the app also accepts Access's JWT, so an Access-fronted deployment keeps working unchanged. `AUTH_DISABLED=false` needs at least one of the two.

The CLI signs in with a token: `collected login` opens Settings → Account, you create a token for the machine and paste it back. Behind Access the CLI still needs the service token to pass the edge (`collected auth service-token <id>`); the API token is what identifies it to the app, and it can do what the CLI needs and nothing destructive (no export, no credentials, no settings, no deletes). Revoke a lost machine's token in Settings → Account.

## Phase 3 — after deploy

- Paste the Canvas cookie into prod: point the CLI at prod (`collected init https://collected.example.com` + `collected auth service-token <id>`, per the "Laptop agent" section below) and run `collected connect canvas`. Through Cloudflare Access the CLI needs the **service token** it stored in `agent.json`; without it Access answers with its login page whatever headers are sent (DECISIONS 038).
- Enter Gradescope credentials and Todoist token in prod settings.
- Fill in Gradescope course ids and `submits_via` per course.
- Enable the Todoist push sync once the homework section looks right for a day.

## Laptop agent (course files → folders)

`collected-agent` (the `agent` workspace) keeps each course's Canvas files in folders on the Mac, sorted by rules and, for anything no rule covers, by Jev, TypeSafe's hosted System 1 decision model (DECISIONS 039). DESIGN.md "File sync to a laptop" has the design; this is the setup.

1. **Access service token**, once. Cloudflare Zero Trust → Access → Service Auth → Service Tokens → Create: name `collected-agent`, pick a long duration. Copy the Client ID and Client Secret (the secret is shown once). Then Access → Applications → `collected` → Policies → Add: name `agents`, action **Service Auth**, Include → Service Token → `collected-agent`. Save. Requests carrying `CF-Access-Client-Id` / `CF-Access-Client-Secret` now get the same JWT the browser does; the app reads the identity from `common_name`.
2. **Build and point the CLI at prod**:
   ```sh
   pnpm install && pnpm --filter agent build
   alias collected="node $PWD/agent/dist/cli.js"                # put in ~/.zshrc; `collected help` lists every command
   alias collected-agent=collected
   collected-agent init https://collected.example.com
   collected-agent auth service-token <client-id> <client-secret>
   ```
   Config lands in `~/.collected/agent.json` (mode 600). For a local server: `init http://localhost:3000` and `auth helper-key <LOCAL_HELPER_KEY>` (or nothing at all with `AUTH_DISABLED=true`).
   For the classifier, make a TypeSafe account at typesafe.ai, create an API key, and `collected-agent auth model <key>` (or export `TYPESAFE_API_KEY`). Without it, rules still work and files no rule matches wait, listed in the dashboard. A local `laya-serve` works instead by setting `model.baseUrl` in `agent.json` to its address.
3. **Turn sync on per course** in the dashboard: course drawer → Files → Sync to laptop → Set up. Name the folders (`slides`, `assignments`, `admin` are the defaults), add rules if the Canvas folder structure is obvious (`^/Lectures` → slides), pick what happens to unmatched files.
4. **Link folders on the Mac**: `collected files courses` lists what the server wants; then `collected files link <course-id> ~/school/ling260` sets a root (targets become `~/school/ling260/slides` etc.), or `files link <course-id> slides Slides` for one target (relative to the root, or absolute). `unsorted` gets a folder the same way; unmapped targets are reported as errors, never silently skipped. In `agent.json` a course can also set `index` (one course-wide `canvas.md`, e.g. `_data/canvas.md`, instead of a `_collected.md` per folder) and `facts` (a folder for `assignments.md`, `announcements.md`, `syllabus.md`); `linkMode: "copy"` for folders iCloud or Dropbox manage; `maxFileMb` for the download cap.
5. **Dry run, then run**: `collected-agent sync --dry-run` prints the plan and posts model decisions so the dashboard shows them; `collected-agent sync` downloads (Canvas CDN → Mac, nothing through the box) into `~/.collected/cache` and hard-links into the folders, writing a `_collected.md` index per folder. Each file no rule decided costs one Jev call (a few hundred input tokens); `--no-model` skips the model.
6. **Schedule**: `collected-agent install-launchd --interval 30` writes `~/Library/LaunchAgents/com.collected.agent.plist` (log: `~/.collected/agent.log`). `uninstall-launchd` removes it.
7. Optional: `"onPlace": "<command>"` in `agent.json` runs after any sync that placed or moved files, with `COLLECTED_PLACED` (newline-separated paths), `COLLECTED_COURSES`, and `COLLECTED_COURSE_ROOTS` (the touched courses' folders) in the environment; point it at whatever ingests your notes.
8. A file the rules skip (starter code, an archive) is listed with its Canvas id in the course index; `collected-agent pull <id> --to <folder>` fetches it and later syncs keep it.
9. The rule set used for the class-notes vault lives in `~/.collected/apply-sync-config.py` (`--apply` writes it to all five courses; without it, it prints how the current rules sort each course).

Your files are safe: the agent records what it placed and never overwrites, moves, or removes a file whose bytes changed (a newer Canvas version lands beside it as `name (v2).pdf`), a file that was already there is adopted rather than duplicated and then left alone, and a file you delete stays deleted.

## Where the Mac still matters

- `collected connect canvas` reads the browser cookie on the Mac. Run it when the Sources widget says Canvas needs auth (should be rare if the ingester keeps polling).
- The file-sync agent runs under launchd and needs the Mac awake to pull new files; the dashboard itself does not.
- Later: the resume pipeline (Claude Code + resume skill) runs on the Mac via launchd, pulls matched jobs from the API, posts results back. Neither needs the Mac awake for the dashboard itself to work.
