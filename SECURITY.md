# Security policy

collected stores real credentials for a student's accounts (a Canvas session cookie, a Gradescope password, Google and Todoist tokens) and a laptop-side agent writes files on the user's machine from what the server tells it. Bugs in either direction matter. Thank you for looking.

## Reporting a vulnerability

Please do not open a public issue for anything that could be a security problem.

Report it privately through GitHub's vulnerability-reporting form for this repository:

```
https://github.com/<owner>/collected/security/advisories/new
```

(`<owner>` is the GitHub account that hosts the copy you found the bug in; for the upstream project it is the account this repository lives under.) The form creates a draft advisory that only you and the maintainers can read. Include what you found, the commit or version, and the steps to reproduce; a proof of concept against a local instance with demo data (`pnpm cli demo canvas`) is ideal.

You will get an acknowledgement within 7 days. If the form is unavailable to you, open an issue that says only "security, please contact me" and a maintainer will reach out.

## Disclosure timeline

- The maintainers aim to confirm the report and agree on severity within 14 days, and to ship a fix within 90 days of the report.
- Public disclosure happens when a fix is released, or 90 days after the report, whichever comes first. If a fix needs longer (rare for a project this size) we will ask for an extension rather than assume one.
- Reporters are credited in the advisory and the release notes unless they prefer not to be.

There is no bug bounty.

## Scope

In scope:

- The server (`server/`): authentication and the identity scopes, the credential store and its encryption, every outbound fetch (SSRF, redirects, pagination, size and time limits), the Canvas read-only proxy, request validation, and anything that would let one source's data delete or alter another's.
- The web app (`web/`): anything that lets upstream content (Canvas pages, announcements, Gradescope HTML, calendar events, job listings) run script or escape a text node, and the file preview sandbox.
- The CLI and laptop agent (`agent/`, published as `collected-cli`): path containment of every file write, the download redirect policy, secrets handling (prompts and `~/.collected/agent.json`), the launchd integration.
- The shared schemas (`shared/`) when a gap there is reachable from a request.
- The Docker image, compose file, and GitHub Actions workflows in this repository.

Out of scope:

- Canvas, Gradescope, Google, Todoist, Cloudflare or GitHub themselves. Report those to the vendor.
- A self-hosted instance that is run with `AUTH_DISABLED=true` on a reachable port. The server refuses that in production unless the operator explicitly acknowledges it; doing so is a configuration choice, not a bug.
- Denial of service that needs an authenticated user, or findings that require a compromised laptop or browser profile (the Canvas cookie lives in the browser by design).
- Reports from automated scanners with no demonstrated impact.

## Supported versions

Only the latest commit on `main` and the latest published `collected-cli` release receive fixes.

## What is already in place

The trust model, so you know what to test against: credentials are AES-256-GCM encrypted at rest with a key kept beside the database; every outbound URL the server fetches is validated to be `https` to a public host and stays on its origin across redirects and pagination; the laptop agent never trusts the server for a filesystem path and checks every write against its own configured targets; credentials presented to the API have scopes (the helper key opens one route, a service token can do what the CLI needs and nothing destructive); ingest fails closed (an empty or failed upstream answer is never treated as a deletion). `artifacts/SECURITY-REVIEW.md` has the last full review and its findings.
