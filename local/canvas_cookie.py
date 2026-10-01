#!/usr/bin/env python3
"""Read the Canvas session cookie from a local browser and hand it to collected.

    python3 local/canvas_cookie.py                                  # -> http://localhost:3000 (creates local/.venv on first run)
    python3 local/canvas_cookie.py --target https://collected.priyamkabra.com
    pnpm canvas-cookie                                              # same thing

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

import subprocess


def ensure_venv() -> None:
    """Create local/.venv with the requirements on first run, then re-exec inside it."""
    here = pathlib.Path(__file__).resolve().parent
    venv = here / ".venv"
    py = venv / "bin" / "python"
    if pathlib.Path(sys.prefix).resolve() == venv.resolve():
        return  # already inside
    if not py.exists():
        print(f"creating {venv} and installing requirements (one-time)…")
        subprocess.check_call([sys.executable, "-m", "venv", str(venv)])
        subprocess.check_call([str(py), "-m", "pip", "install", "-q", "-r", str(here / "requirements.txt")])
    os.execv(str(py), [str(py), str(pathlib.Path(__file__).resolve()), *sys.argv[1:]])


ensure_venv()

try:
    import browser_cookie3  # type: ignore
except ImportError:  # pragma: no cover
    sys.exit("browser_cookie3 missing inside local/.venv; delete local/.venv and run again")

BROWSERS = ["chrome", "chromium", "brave", "edge", "arc", "vivaldi", "opera", "safari", "firefox"]


def read_env_value(repo_root: pathlib.Path, key: str) -> str | None:
    env = repo_root / ".env"
    if not env.exists():
        return None
    for line in env.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def read_env_key(repo_root: pathlib.Path) -> str | None:
    return read_env_value(repo_root, "LOCAL_HELPER_KEY")


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", default=os.environ.get("COLLECTED_URL", "http://localhost:3000"))
    p.add_argument("--domain", default="umd.instructure.com")
    p.add_argument("--browser", default="chrome", choices=BROWSERS)
    p.add_argument("--key", default=os.environ.get("LOCAL_HELPER_KEY") or read_env_key(repo_root))
    p.add_argument("--cookie-file", default=None, help="path to a specific Chromium profile Cookies DB (auto-detected otherwise)")
    p.add_argument("--dry-run", action="store_true", help="only report which cookies were found")
    args = p.parse_args()

    loader = getattr(browser_cookie3, args.browser)
    session_names = ("canvas_session", "_normandy_session", "_legacy_normandy_session")

    def read(cookie_file: str | None) -> dict[str, str]:
        kwargs = {"domain_name": args.domain}
        if cookie_file:
            kwargs["cookie_file"] = cookie_file
        jar = loader(**kwargs)
        return {c.name: c.value for c in jar if args.domain in (c.domain or "")}

    candidates: list[str | None] = [args.cookie_file] if args.cookie_file else [None]
    if not args.cookie_file and args.browser in ("chrome", "chromium", "brave", "edge", "arc", "vivaldi"):
        # Chromium keeps one cookie DB per profile; the default loader only reads "Default".
        roots = {
            "chrome": "~/Library/Application Support/Google/Chrome",
            "chromium": "~/Library/Application Support/Chromium",
            "brave": "~/Library/Application Support/BraveSoftware/Brave-Browser",
            "edge": "~/Library/Application Support/Microsoft Edge",
            "arc": "~/Library/Application Support/Arc/User Data",
            "vivaldi": "~/Library/Application Support/Vivaldi",
        }
        root = pathlib.Path(roots[args.browser]).expanduser()
        for prof in sorted(root.glob("*/Cookies")) + sorted(root.glob("*/Network/Cookies")):
            if "Default" in prof.parts:
                continue
            candidates.append(str(prof))

    cookies: dict[str, str] = {}
    used = None
    errors = []
    for cf in candidates:
        try:
            found = read(cf)
        except Exception as e:  # keychain prompt declined, locked DB, etc.
            errors.append(f"{cf or 'default profile'}: {e}")
            continue
        if any(n in found for n in session_names):
            cookies, used = found, cf
            break
        if not cookies:
            cookies = found
    if not any(n in cookies for n in session_names):
        hint = f" (errors: {'; '.join(errors)})" if errors else ""
        sys.exit(
            f"no Canvas session cookie ({' / '.join(session_names)}) for {args.domain} in {args.browser}; "
            f"open Canvas in that browser and log in first, or pass --cookie-file for a specific profile{hint}"
        )
    print(f"found {len(cookies)} cookies for {args.domain} in {args.browser}{' profile ' + used if used else ''}: {', '.join(sorted(cookies))}")
    if args.dry_run:
        return 0

    header = "; ".join(f"{k}={v}" for k, v in cookies.items())
    body = json.dumps({"cookieHeader": header, "baseUrl": f"https://{args.domain}"}).encode()
    headers = {"Content-Type": "application/json"}
    if args.key:
        headers["X-Collected-Key"] = args.key
    # Through Cloudflare Access (prod) a script needs a service token too; the key alone never passes the edge.
    cf_id = os.environ.get("CF_ACCESS_CLIENT_ID") or read_env_value(repo_root, "CF_ACCESS_CLIENT_ID")
    cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET") or read_env_value(repo_root, "CF_ACCESS_CLIENT_SECRET")
    if cf_id and cf_secret:
        headers["CF-Access-Client-Id"] = cf_id
        headers["CF-Access-Client-Secret"] = cf_secret
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
