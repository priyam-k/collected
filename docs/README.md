# docs/

Documentation for people who run or use collected. The engineering notes (architecture, decisions, setup) live in [`artifacts/`](../artifacts/).

| File | What it is for |
| --- | --- |
| [`self-host.md`](self-host.md) | Run your own instance: Docker, TLS with Caddy or a Cloudflare Tunnel, the Google OAuth client, connecting sources, backups, updates, the CLI. Start here. |
| [`Caddyfile`](Caddyfile) | Reverse proxy with automatic HTTPS for the self-host guide, step 4. |
| `screenshots/` | Images used by the README (`dashboard.png` is the board, also served by the web app). Retake them all with `SCREENSHOTS=1 pnpm exec playwright test specs/screenshots.spec.ts` from `e2e/`. |

Related, elsewhere in the repo:

- [`README.md`](../README.md) — the three ways to run it (laptop, self-host, hosted) and local development. The backend is `core/` (database, ingesters, syncs, scheduler) with `server/` as its HTTP layer; the CLI's local mode (`collected init --local`, documented in [`agent/README.md`](../agent/README.md#local-mode)) runs the same core on one machine with no server.
- [`.env.example`](../.env.example) — every environment variable, commented.
- [`scripts/backup.sh`](../scripts/backup.sh), [`scripts/deploy.sh`](../scripts/deploy.sh) — what the self-host guide's backup and update steps call.
- The in-app Privacy and Terms pages (`/privacy`, `/terms`) describe what a hosted instance stores and why; their source is `web/src/pages/public/`.
