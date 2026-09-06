#!/usr/bin/env python3
"""Read the Canvas session cookie from a local browser and hand it to collected.

    python3 -m venv local/.venv && local/.venv/bin/pip install -r local/requirements.txt
    local/.venv/bin/python local/canvas_cookie.py                       # -> http://localhost:3000
    local/.venv/bin/python local/canvas_cookie.py --target https://collected.priyamkabra.com

The helper key is read from --key, $LOCAL_HELPER_KEY, or LOCAL_HELPER_KEY= in the repo's .env.
Nothing about the cookie is printed.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

try:
    import browser_cookie3  # type: ignore
except ImportError:  # pragma: no cover
    sys.exit("browser_cookie3 not installed. Run: local/.venv/bin/pip install -r local/requirements.txt")

BROWSERS = ["chrome", "chromium", "brave", "edge", "arc", "vivaldi", "opera", "safari", "firefox"]


def read_env_key(repo_root: pathlib.Path) -> str | None:
    env = repo_root / ".env"
    if not env.exists():
        return None
    for line in env.read_text().splitlines():
        if line.startswith("LOCAL_HELPER_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", default=os.environ.get("COLLECTED_URL", "http://localhost:3000"))
    p.add_argument("--domain", default="umd.instructure.com")
    p.add_argument("--browser", default="chrome", choices=BROWSERS)
    p.add_argument("--key", default=os.environ.get("LOCAL_HELPER_KEY") or read_env_key(repo_root))
    p.add_argument("--dry-run", action="store_true", help="only report which cookies were found")
    args = p.parse_args()

    loader = getattr(browser_cookie3, args.browser)
    try:
        jar = loader(domain_name=args.domain)
    except Exception as e:  # keychain prompt declined, browser not installed, etc.
        sys.exit(f"could not read {args.browser} cookies: {e}")

    cookies = {c.name: c.value for c in jar if args.domain in (c.domain or "")}
    if "_normandy_session" not in cookies:
        sys.exit(f"no _normandy_session cookie for {args.domain} in {args.browser}; open Canvas in that browser and log in first")
    print(f"found {len(cookies)} cookies for {args.domain} in {args.browser}: {', '.join(sorted(cookies))}")
    if args.dry_run:
        return 0

    header = "; ".join(f"{k}={v}" for k, v in cookies.items())
    body = json.dumps({"cookieHeader": header, "baseUrl": f"https://{args.domain}"}).encode()
    headers = {"Content-Type": "application/json"}
    if args.key:
        headers["X-Collected-Key"] = args.key
    req = urllib.request.Request(f"{args.target.rstrip('/')}/api/sources/canvas/cookie", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            out = json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"{args.target} rejected the cookie: HTTP {e.code} {e.read().decode()[:200]}")
    except urllib.error.URLError as e:
        sys.exit(f"could not reach {args.target}: {e.reason}")
    outcome = out.get("outcome") or {}
    if outcome.get("ok"):
        print("cookie accepted; Canvas synced:", json.dumps(outcome.get("result", {}).get("counts", {})))
    else:
        print("cookie stored, but the first sync did not succeed:", json.dumps(outcome))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
