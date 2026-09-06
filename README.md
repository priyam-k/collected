# collected

One dashboard for everything a student juggles: Canvas, Gradescope, Google Calendar, Todoist, and a job feed, as a grid of widgets you can rearrange. Single user, self-hosted.

Docs live in [`artifacts/`](artifacts/): [DESIGN](artifacts/DESIGN.md) is the spec, [SETUP](artifacts/SETUP.md) walks through the external accounts and the VPS, [PROGRESS](artifacts/PROGRESS.md) is the milestone checklist, [DECISIONS](artifacts/DECISIONS.md) is the why.

## Run it

```sh
npm i -g pnpm
pnpm install
cp .env.example .env            # set SECRET_KEY (openssl rand -hex 32) and AUTH_DISABLED=true for local dev
pnpm dev                        # server on :3000, web on :5173
```

Open http://localhost:5173, then Settings → Sources to connect things. `pnpm cli demo canvas|gradescope|gcal|todoist` loads fixture data if you want to see the widgets before connecting anything.

Useful commands:

```sh
pnpm sync canvas               # run one ingester now (also: gradescope, gcal, todoist, jobs, all)
pnpm cli push --dry-run        # preview the Todoist push
pnpm cli export > backup.json  # courses, settings, layout (no secrets)
pnpm -r typecheck && pnpm -r test
pnpm build && (cd server && node dist/index.js)   # production mode on :3000
```

Deploy: `docker compose up -d --build` behind a Cloudflare Tunnel with Cloudflare Access in front. Steps in [SETUP.md](artifacts/SETUP.md).
