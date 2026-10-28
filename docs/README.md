# docs/

Documentation for people who run or use collected. The engineering notes (architecture, decisions, setup) live in [`artifacts/`](../artifacts/).

| File | What it is for |
| --- | --- |
| [`self-host.md`](self-host.md) | Run your own instance: Docker, TLS with Caddy or a Cloudflare Tunnel, the Google OAuth client, connecting sources, backups, updates, the CLI. Start here. |
| [`Caddyfile`](Caddyfile) | Reverse proxy with automatic HTTPS for the self-host guide, step 4. |
| `screenshots/` | Images used by the README (`dashboard.png` is the board, also served by the web app). Retake them all with `SCREENSHOTS=1 pnpm exec playwright test specs/screenshots.spec.ts` from `e2e/`. |

Related, elsewhere in the repo:

- [`README.md`](../README.md) — local development in four commands.
- [`.env.example`](../.env.example) — every environment variable, commented.
- [`scripts/backup.sh`](../scripts/backup.sh), [`scripts/deploy.sh`](../scripts/deploy.sh) — what the self-host guide's backup and update steps call.
- The in-app Privacy and Terms pages (`/privacy`, `/terms`) describe what a hosted instance stores and why; their source is `web/src/pages/public/`.
