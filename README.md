# collected

One dashboard for everything a student juggles. collected copies your Canvas assignments, Gradescope submissions, Google Calendar, Todoist tasks and a public internship feed into one small server you run yourself, and shows them as a grid of widgets you can rearrange: a week calendar, a to-do list that knows what you have already submitted, one row per class, a job feed with an applications tracker. It never owns the data (Canvas stays the truth about assignments, Google about events) and never writes back except where you ask it to. A companion CLI reads the same data from the terminal and keeps your course files sorted into folders on your laptop.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="The dashboard: week calendar, to-do list, sources, job feed and classes overview" width="100%">
</p>
<p align="center">
  <img src="docs/screenshots/course-pane.png" alt="A course pane: grade, schedule, dates, announcements and recent files" width="49%">
  <img src="docs/screenshots/file-sync.png" alt="The Files tab of a course with the laptop file-sync panel" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/settings-courses.png" alt="Settings: courses, with their Canvas and Gradescope ids" width="49%">
  <img src="docs/screenshots/settings-sources.png" alt="Settings: sources, where each account is connected" width="49%">
</p>

## Features

**Sources.** Canvas (assignments, planner, announcements, modules, files, grades, with the iCal feed as a fallback), Gradescope (student submissions and, if you TA, the grading queue), Google Calendar (incremental sync, quick-add events), Todoist (tasks, labels, and an optional one-way push of assignments into a project), and an internship feed (the public Simplify listings, filtered by your own rules). Each source syncs on its own timer, fails on its own, and reports its status; a dead scraper degrades one panel, never the app.

**Widgets.** Calendar (agenda, day, week, month), to-do (open tasks and assignments, grouped, with "done here only"), classes overview, sources, job feed, applications tracker, and smaller ones. Every widget renders at every size; drag and resize them in edit mode; layouts are saved per breakpoint, and the mobile view stacks them.

**Course panes.** Click a class for its grade (recomputed Canvas-style from assignment groups, with your own syllabus weights if Canvas is wrong), schedule and next meeting, exam and quiz dates, announcements, syllabus, modules and files, and the assignments split into to-do and done. Linked Canvas and Gradescope rows for the same homework collapse into one.

**File sync and CLI.** `collected-cli` on your laptop pulls new course files from Canvas into folders you name, sorted by rules you write (or a small decision model for the rest), and writes a per-course index plus assignments and announcements as Markdown. The same CLI reads your agenda, grades and announcements, and makes small edits (tasks, notes, hotlinks, dates).

**Agent-friendly.** Every CLI read takes `--json`, the API is plain resource-shaped JSON, and the Markdown the file sync writes is meant to be read by whatever note-taking or AI tooling you point at the folder.

## Run it

### Self-host with Docker Compose

One container, one SQLite file in `./data`. You need a box that is always on (a free-tier cloud VM is enough) and something in front of it for login: the shipped setup uses Cloudflare Tunnel plus Cloudflare Access, so no port is open to the internet and Cloudflare checks your email before any request reaches the app.

```sh
git clone https://github.com/<you>/collected.git && cd collected
cp .env.example .env            # set PUBLIC_URL, the Cloudflare Access values, Google OAuth, TZ
docker compose up -d
```

The full walk-through, including the Google Cloud project for Calendar, the tunnel, backups and the GitHub Actions deploy, is in [`artifacts/SETUP.md`](artifacts/SETUP.md). Then open the site, go to Settings → Sources and connect each account.

### Local development

Needs Node 22+ and pnpm.

```sh
npm i -g pnpm
pnpm install --frozen-lockfile
cp .env.example .env            # set AUTH_DISABLED=true; leave SECRET_KEY empty
pnpm cli demo canvas            # fixture data so the widgets are not empty (also: gradescope, gcal, todoist, gtasks)
pnpm dev                        # server on :3000, web on :5173
```

Open http://localhost:5173. Useful afterwards:

```sh
pnpm sync canvas               # run one ingester now (also: gradescope, gcal, todoist, jobs, all)
pnpm cli push --dry-run        # preview the Todoist push
pnpm cli export > backup.json  # courses, settings, layout (no secrets)
pnpm cli demo clear            # remove the demo rows
pnpm -r typecheck && pnpm -r test
```

### Hosted

A hosted version, so you can sign in and connect your accounts without running a server, is coming. Until then, self-host.

## CLI and file sync

```sh
npm i -g collected-cli
collected init https://collected.example.com    # your server
collected connect canvas                        # hand your Canvas session to the server (being built; until it lands, paste the cookie in Settings → Sources)
collected files link cs101 ~/School/CS101       # where this course's files should land
collected sync                                  # pull new files now; `collected install-launchd` runs it every 30 minutes
collected agenda                                # what is due this week
collected help
```

The server stores only the *names* of your target folders; the paths live in `~/.collected/agent.json` on your machine. Nothing the server says can make the CLI write outside a folder you linked, and a file you edited after it was placed is never overwritten. Details and every command: [`agent/README.md`](agent/README.md).

## For AI agents

`skills/collected/SKILL.md` teaches an agent (Claude Code, or anything that reads a skill file) what the `collected` CLI can do, which commands are safe to run freely and which change things. Copy it into your agent's skills folder (for Claude Code: `~/.claude/skills/collected/SKILL.md`) and the agent can answer "what's due this week" or "add an exam date" through the CLI.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability. The trust model in four lines:

- Credentials (Canvas cookie, Gradescope password, Google and Todoist tokens) are AES-256-GCM encrypted at rest and never returned by the API or written to logs.
- The laptop never trusts the server for a filesystem path: targets are validated against the names you configured, every write is checked to be inside the linked folder, and downloads follow only `https` redirects to public hosts.
- Every outbound URL the server fetches is validated (`https`, public host), bounded in time and size, and pinned to its origin across redirects and pagination.
- CLI tokens are scoped: a service token can do what the CLI needs and nothing destructive; the helper key opens a single route.

## Docs

[`artifacts/OVERVIEW.md`](artifacts/OVERVIEW.md) is the backend in ten minutes, [`artifacts/DESIGN.md`](artifacts/DESIGN.md) the spec, [`artifacts/REFERENCE.md`](artifacts/REFERENCE.md) every route and column, [`artifacts/DECISIONS.md`](artifacts/DECISIONS.md) the why, [`CONTRIBUTING.md`](CONTRIBUTING.md) how to send a change, [`docs/releasing.md`](docs/releasing.md) how the CLI is published.

## License

[AGPL-3.0-only](LICENSE). If you run a modified version for other people, you have to offer them the source.
