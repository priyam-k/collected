# local helpers

Scripts that only make sense on the Mac where your browser lives.

## canvas_cookie.py

Reads the Canvas session cookie out of Chrome (via `browser_cookie3`, which decrypts Chrome's cookie store with the key in the macOS Keychain; expect one Keychain prompt) and posts it to collected. Run it whenever the Sources widget says Canvas needs auth.

```sh
python3 -m venv local/.venv
local/.venv/bin/pip install -r local/requirements.txt
local/.venv/bin/python local/canvas_cookie.py --dry-run          # just list cookies
local/.venv/bin/python local/canvas_cookie.py                    # local dev server
local/.venv/bin/python local/canvas_cookie.py --target https://collected.priyamkabra.com
```

The production target sits behind Cloudflare Access, which blocks scripts. Either create an Access **service token** and send its two headers (a one-line change in this script), or paste the cookie into Settings → Sources on the site instead.
