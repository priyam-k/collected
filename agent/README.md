# collected-cli

The command-line client for [collected](https://github.com/priyam-k/collected), the self-hosted student dashboard. It talks to your own collected server: read what is due, make small edits, browse Canvas read-only, and keep course files synced into folders on this machine.

The dashboard reads are the same data the web app shows (assignments, agenda, grades, announcements, dates, sources, the jobs tracker). The file sync is laptop-only by design: the server knows the *names* of your target folders, this machine knows the paths, and the server never sees file bytes.

## Install

Needs Node 22.12 or newer and nothing else: the package carries the whole app for local mode (the backend, the database migrations, the demo fixtures and the built dashboard), so a machine with Node is a machine that can run collected.

```sh
npm i -g collected-cli
collected init --local                 # no server: a SQLite database in ~/.collected/data
collected demo canvas                  # something to look at
collected ui                           # the dashboard at http://127.0.0.1:4848
```

Or, against your own server, `collected init https://collected.example.com` (see [Set up](#set-up)). Two binaries are installed, `collected` and `collected-agent`; they are the same program. `npx -p collected-cli collected help` runs it without installing. The install is about 60 MB on disk, most of it the SQLite driver (`@libsql/client`, which brings a prebuilt binary for macOS, Linux x64 and arm64, and Windows x64).

### Upgrading

`collected --version` prints the installed version. `collected upgrade` installs the newest one with whatever installed this one: it reads the running script's path to tell a global npm install (`npm install -g collected-cli@latest`; nvm, volta, fnm and Homebrew's node all count) from a pnpm global (`pnpm add -g collected-cli@latest`) or a bun global (`bun add -g collected-cli@latest`), asks npm which version it is about to install, prints the command, and runs it with your terminal attached; afterwards it prints the new version. `--dry-run` prints without running. When it cannot tell how the CLI was installed (a project-local `node_modules`, the `npx` cache, a checkout of the repository) it prints the npm command and exits 1, and you run the right one yourself.

Once a day, at most, a command may end with one line on stderr such as

```
collected-cli 1.2.0 · server 1.3.0 · run: collected upgrade
collected-cli 1.2.0 · 1.3.0 on npm · run: collected upgrade
```

The first means your server runs a newer minor than this CLI: every command still works (same major is compatible), but the server may have commands or fields this CLI does not know. The second means npm has a newer release than the one running, in local mode or against a server. Both can appear on one line. The notice is on stderr only, so `--json` output is unaffected; the day's timestamp and what npm answered live in `~/.collected/state.json`; a network failure is silent unless you pass `--verbose`; `NO_UPDATE_NOTIFIER=1` in the environment keeps the npm check off entirely. A server that is a major version ahead, or that says it needs a newer CLI than this one (`minClient` in `GET /api/system/version`), is refused before anything is sent: the command exits 2 with the same line plus `this server needs collected-cli >= <version>`, and `collected upgrade` is the fix. Local mode has no server to disagree with.

## Set up

```sh
collected init https://collected.example.com     # your server (https; http only for localhost)
collected auth service-token <client-id>          # prompts for the secret; keeps it out of shell history
collected courses                                 # proves the connection
```

`init` writes the config file and prints the next steps. For a server you run locally with `AUTH_DISABLED=true`, use `collected auth helper-key` with the server's `LOCAL_HELPER_KEY` instead of a service token. `collected connect canvas` reads the Canvas session from your browser and hands it to the server; the fallback is pasting the cookie in Settings → Sources.

No server at all? See [Local mode](#local-mode).

## Local mode

Local mode runs collected inside the command itself: the same backend the server runs, over a SQLite database on this machine. No server, no Docker, no `.env`. Every command works the same way; the difference is where the data lives.

```sh
collected init --local                 # or --data-dir <path>; default ~/.collected/data
collected demo canvas                  # fixture courses and assignments, to look around (demo clear removes them)
collected courses
collected status                       # "local · <data dir>"
```

The data directory (created `0700`) holds `collected.db`, the encryption key (`.secret_key`, created on first use), the pre-migration snapshots under `backups/`, the daemon's log and the per-source lock files (`sync.lock/`). It is yours to back up or delete. `collected sync <source|all>` runs a source's sync right there and waits for it; `collected connect canvas` stores the Canvas session in the local database and syncs it. `login` and `auth service-token` have nothing to do in local mode and say so.

### The dashboard: `collected ui`

```sh
collected ui                           # http://127.0.0.1:4848, opened in your browser; Ctrl-C stops it
collected ui --port 5000 --no-open
```

The same web dashboard a server shows, over the local database. It listens on the loopback address only and asks for no sign-in: anyone who can open the page is already on this machine with access to the data folder, so Settings → Account says so and has nothing to sign out of. While it runs, the scheduler keeps every connected source fresh on its usual cadence (Canvas every 15 minutes, Gradescope every 30, calendars and to-do apps every 5), and `/` goes straight to the board. Against a server, `collected ui` just prints the server's address and opens it. The dashboard ships inside the package (`dist/web`); from a repository checkout it is the repo's own `web/dist` (`pnpm --filter web build`).

### Fresh answers without the dashboard open

A read (`agenda`, `todo`, `assignments`, `dates`, `grades`, `announcements`, `course`, `jobs`) looks at when each source it depends on last succeeded, and when a connected one is older than `freshness.maxAgeMinutes` (30 by default, in `agent.json`) it syncs that source first, then answers. The check is one database read, so an agent calling the CLI in a loop pays nothing when the data is recent. `courses`, `sources`, `links` and the Canvas commands never sync. Two flags on any read:

```
--fresh       sync every connected source the command depends on, whatever its age
--stale-ok    never sync; answer from what is there
```

A sync that fails never blocks the answer: one line on stderr, and the command prints what the database has. A source that needs a credential or failed last time is not retried from a read. A source already being synced by another process (`collected ui`, the daemon, another terminal) is left alone: every run holds a lock file under `sync.lock/`, so two processes never sync the same source at once.

### Keeping it fresh in the background: `collected daemon`

```sh
collected daemon install               # a user-level timer running `collected sync all` every 15 minutes
collected daemon status                # installed or not, and the last run from <data dir>/daemon.log
collected daemon uninstall
```

macOS gets `~/Library/LaunchAgents/com.collected.sync.plist` (loaded with `launchctl bootstrap gui/$UID`); Linux a systemd user service and timer under `~/.config/systemd/user/` (`collected-sync.timer`, enabled with `systemctl --user enable --now`); on Windows the command prints the `schtasks` line to run yourself. The unit calls the exact binary you ran `install` from, so after moving or upgrading the CLI run `install` again. The period is `daemon.intervalMinutes` in `agent.json` (minimum 5). Nothing secret goes into the unit: credentials live in the database, and the unit carries paths only.

### Google Calendar and Google Tasks: `collected connect google`

```sh
collected connect google               # Google Calendar: opens the consent screen, waits for Google to come back
collected connect google tasks         # Google Tasks, its own consent (the tasks scope only)
collected connect google --no-open     # prints the URL instead of opening a browser
```

No Google Cloud project is needed: the package carries a Google OAuth client of the "Desktop app" kind, and that kind accepts any `http://127.0.0.1:<port>/...` redirect, so the sign-in finishes on whatever loopback port the command (or `collected ui`) is listening on. The command starts the same app `ui` serves on an ephemeral port without the scheduler, opens Google, waits up to three minutes for the browser to land back on it, prints the result (the calendars or lists it found) and stops the listener. The Connect buttons under Settings → Sources in `collected ui` do the same thing from the page. The flow carries PKCE, and the refresh token lands encrypted in the local database like every other credential. Against a server, the command says to use Settings → Sources there: the sign-in has to end where the server's redirect URI points.

A build can ship without the built-in client (the Sources page says so, and `connect google` says so before it listens); then either add your own client to `~/.collected/.env` (below) or use the Google Calendar (iCal) source, which needs no sign-in.

Todoist in local mode takes a pasted API token (Todoist → Settings → Integrations → Developer). Sign in with Todoist needs a Todoist app of your own, because Todoist registers one exact redirect URL per app and has no loopback exception: register one at `https://developer.todoist.com/appconsole.html` with `http://127.0.0.1:4848/api/todoist/callback` (the `ui` port) and put its id and secret in `~/.collected/.env`.

### `~/.collected/.env`: overrides for local mode

Optional. Same syntax as a server `.env` (`KEY=value`, quotes, `#` comments); make it `chmod 600` (the CLI warns when other users can read it). It is read into the in-process server's config and never into the environment. Only these keys are read; anything else is ignored, and `--verbose` names what was skipped:

```
GOOGLE_CLIENT_ID=        # your own Google OAuth client, "Desktop app" kind; wins over the built-in one
GOOGLE_CLIENT_SECRET=    #   (both or neither: an id without a secret switches Google connect off, with a note)
TODOIST_CLIENT_ID=       # a Todoist app of your own, for Sign in with Todoist (pasted tokens need nothing)
TODOIST_CLIENT_SECRET=
TZ=America/New_York      # the zone a fresh database is seeded with; default: this machine's
LOG_LEVEL=info           # the in-process server's log level on stderr; default warn; --verbose means info
UPSTREAM_REPO=owner/name # only matters for a fork
```

The override location lives in `agent.json`'s directory: with `COLLECTED_AGENT_HOME` set, the file is `$COLLECTED_AGENT_HOME/.env`.

## Commands

Add `--json` to any read for machine-readable output; everything is written so another program (or an agent) can call it.

Look:

```
courses                                     every course: role, schedule, hotlinks
course <course>                             one course: schedule, links, notes, grade, what's due, dates
assignments [--course C] [--days 14] [--all]
agenda [--days 7]                           events, due dates and tasks by day
todo                                        open tasks and open assignments
grades [course]
announcements [--course C] [--limit 5]
dates [--course C]                          exams, quizzes, finals, cancelled or virtual sessions
sources                                     sync status of every source
jobs [--state applied,screen] [--limit 20]  the applications tracker
```

Change:

```
task add "<text>"                           a Todoist task, natural language
task done <task-id>
done <item-id> [--undo]                     mark an assignment done on the dashboard only
link add <course> <label> <url>   |   link rm <course> <label>
schedule set <course> <kind> "<days> <start>-<end> [@ room]"   |   schedule rm <course> <kind>
notes set <course> "<text>"       |   notes clear <course>
date add <course> <exam|quiz|final|cancelled|virtual|other> "<title>" <YYYY-MM-DD> [...]   |   date rm <id>
jobs set <job-id> <state> [--notes N] [--next "what" --next-at YYYY-MM-DD]
resync [canvas|gradescope|gcal|todoist|jobs|all]
```

Local mode only (`collected init --local`):

```
ui [--port 4848] [--no-open]                the dashboard at http://127.0.0.1:<port> until Ctrl-C, syncing in the background
connect google [calendar|tasks] [--no-open] the Google sign-in in your browser, on a temporary loopback port; no project needed
daemon install | uninstall | status         a user timer running `sync all` every 15 minutes (daemon.intervalMinutes)
demo <canvas|gradescope|gcal|todoist|gtasks>   load that source's fixture data into the local database
demo clear                                  remove everything the demo loaders created
sync <source|all>                           run a source sync in-process and wait for it (same as resync)
--fresh | --stale-ok                        on any read: sync first regardless of age, or never (default: older than freshness.maxAgeMinutes)
```

Canvas, read-only (one GET through the server with its stored session; nothing is ever written to Canvas):

```
canvas ls <course> [modules|files|pages|assignments|announcements]
canvas show <course> syllabus | page <slug> | assignment <id> | announcement <id>
canvas get "<api path>" [--all]
pull <canvas-file-id> --to <folder>
```

File sync:

```
files courses                               what the server wants synced and where it lands here
files link <course-id> <path>               root folder for a course
files link <course-id> <target> <path>      one named target (e.g. readings, slides) to a folder
files unlink <course-id> [target]
sync [--dry-run] [--course X] [--no-model]  run the file sync now
status                                      last sync and what has been placed
install-launchd [--interval 30]             run the sync every N minutes in the background (macOS)
uninstall-launchd
```

This program:

```
--version                                   print the version
upgrade [--dry-run]                         install the newest collected-cli from npm with whatever installed this one
```

A `<course>` is its code (`cs101`), the digits (`101`), or the full id.

## Config file

`~/.collected/agent.json` (override the directory with `COLLECTED_AGENT_HOME`). It holds the server URL (or `local`, with the data directory under `local.dataDir`, `freshness.maxAgeMinutes` and `daemon.intervalMinutes`), the credential, this machine's name, the cache directory, the per-course folder links, and the optional classifier settings. It is written `0600` and is the only place filesystem paths live; the server never learns them. `state.json` next to it is the program's own memory: what the file sync has placed, and when the version notice last ran and what it saw. Local mode's optional overrides (OAuth clients, `TZ`, `LOG_LEVEL`) go in `~/.collected/.env` next to it, see [above](#collectedenv-overrides-for-local-mode).

`collected auth model` stores a TypeSafe key for the Jev classifier that sorts files the rules cannot place. Skip it to sort by rules only.

## Safety rules the sync follows

- A file is written only under a folder you linked, never anywhere the server names. Targets are validated against the names you configured and the resolved path must stay inside the linked root.
- A file you edited or moved after the sync placed it is never overwritten or removed.
- Downloads follow only `https` redirects to public hosts, with a size cap and a timeout; no auth header crosses a redirect.
- Secrets are read from a prompt or stdin, never from a command-line argument.

## launchd

`collected install-launchd --interval 30` writes `~/Library/LaunchAgents/com.collected.agent.plist` and loads it, so the file sync runs every 30 minutes while you are logged in; the log is `~/.collected/agent.log`. `collected uninstall-launchd` removes it. On Linux use a user cron entry or a systemd timer that runs `collected sync`. (The source sync in local mode has its own timer: `collected daemon install`, above.)

## License

AGPL-3.0-only. Source: https://github.com/priyam-k/collected (the `agent/` workspace).
