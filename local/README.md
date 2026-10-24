# local helpers

Scripts that only make sense on the Mac where your browser lives.

## canvas_cookie.py

Reads the Canvas session cookie out of Chrome (via `browser_cookie3`, which decrypts Chrome's cookie store with the key in the macOS Keychain; expect one Keychain prompt the first time) and posts it to collected. Run it whenever the Sources widget says Canvas needs auth.

```sh
pnpm canvas-cookie                     # local dev server on :3000; creates local/.venv on first run
pnpm canvas-cookie -- --dry-run        # just list the cookies it found
pnpm canvas-cookie -- --browser arc    # chrome | chromium | brave | edge | arc | vivaldi | opera | safari | firefox
pnpm canvas-cookie -- --target https://collected.priyamkabra.com
```

The production target sits behind Cloudflare Access, which blocks scripts. The script reads the Access **service token** and the helper key from `~/.collected/agent.json` once the CLI is set up (`collected auth service-token <id>`, `collected auth helper-key`), falling back to `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` / `LOCAL_HELPER_KEY` in the environment or the repo `.env`. Or paste the cookie into Settings → Sources on the site instead. Only the three Canvas session cookies are sent, and only to an https target (http is accepted for localhost).
