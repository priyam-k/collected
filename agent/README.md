# collected-cli

The command-line client for [collected](https://collected.priyamkabra.com) ([source](https://github.com/priyam-k/collected)), the open-source student dashboard. It runs the whole thing on your laptop in local mode, or talks to your own collected server: read what is due, make small edits, browse Canvas read-only, and keep course files synced into folders on this machine.

The dashboard reads are the same data the web app shows (assignments, agenda, grades, announcements, dates, sources, the jobs tracker). The file sync is laptop-only by design: the server knows the *names* of your target folders, this machine knows the paths, and the server never sees file bytes.

## Install

On macOS and Linux with [Homebrew](https://brew.sh), the tap installs the CLI and the Node it needs:

```sh
brew install priyam-k/collected/collected-cli
```

Anywhere with Node 22.12 or newer, npm does the same and nothing else is needed: the package carries the whole app for local mode (the backend, the database migrations, the demo fixtures and the built dashboard), so a machine with Node is a machine that can run collected.

```sh
npm i -g collected-cli
```

Then:

```sh
collected quickstart                   # the setup as a conversation: a few steps, each explained first
```

`quickstart` asks where collected should run (this computer, the default, or a server you already have) and writes the config; connects Canvas by reading the session cookie from your browser, with the paste and token routes printed when that fails; imports your current-term courses from Canvas; offers Google Calendar and Google Tasks (each a browser consent, yes or no); takes a Todoist API token at a hidden prompt, or Enter to skip; offers the background timer; then prints the next three days and, in local mode, offers to open the dashboard. Enter takes the default and `s` skips a step. It is safe to run again: a step whose work exists (the config, a connected source, the installed timer) says so and moves on, and a step that fails prints the error and the wizard continues. `collected quickstart --agent` prints the same steps as a plan for an AI agent that will run the CLI for you (`--json` for the structured form): the website says only "install, then run `collected quickstart --agent`", so the plan always matches the commands installed.

Or by hand:

```sh
collected init --local                 # no server: a SQLite database in ~/.collected/data
collected demo canvas                  # something to look at
collected ui                           # the dashboard at http://127.0.0.1:4848
```

Or, against your own server, `collected init https://collected.example.com` (see [Set up](#set-up)). Two binaries are installed, `collected` and `collected-agent`; they are the same program. `npx -p collected-cli collected help` runs it without installing. The install is about 60 MB on disk, most of it the SQLite driver (`@libsql/client`, which brings a prebuilt binary for macOS, Linux x64 and arm64, and Windows x64).

### Upgrading

`collected --version` prints the installed version. `collected upgrade` installs the newest one with whatever installed this one: it reads the running script's path to tell a Homebrew install (`brew upgrade collected-cli`) from a global npm install (`npm install -g collected-cli@latest`; nvm, volta, fnm and Homebrew's node all count), a pnpm global (`pnpm add -g collected-cli@latest`) or a bun global (`bun add -g collected-cli@latest`), asks npm which version it is about to install, prints the command, and runs it with your terminal attached; afterwards it prints the new version. `--dry-run` prints without running. When it cannot tell how the CLI was installed (a project-local `node_modules`, the `npx` cache, a checkout of the repository) it prints the npm command and exits 1, and you run the right one yourself.

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

`init` writes the config file and prints the next steps. For a server you run locally with `AUTH_DISABLED=true`, use `collected auth helper-key` with the server's `LOCAL_HELPER_KEY` instead of a service token. `collected connect canvas` connects Canvas: it reads the Canvas session cookie from the browser you are signed in with and hands it to the server. If it cannot, paste the cookie value in Settings → Sources → Canvas (below). If your school allows personal access tokens (many, UMD among them, turn them off), `collected connect canvas --token` is the alternative: make one in Canvas under Account → Settings → Approved Integrations → "+ New Access Token" (leave the expiry blank and it never expires), run the command, paste the token at the prompt (or pipe it on stdin; it is never a flag), and it is checked against your Canvas before the server stores it. No browser, no Keychain, no DevTools.

### Which browsers `connect canvas` can read

`connect canvas --token` needs none of this. Firefox and its forks (Zen, LibreWolf, Floorp, Waterfox) keep their cookies in the clear, so they work everywhere and never prompt. Chromium browsers encrypt theirs with a key the operating system guards, and whether a program running as you can get that key depends on the platform. `--browser <name>` picks one (`chrome`, `brave`, `edge`, `arc`, `chromium`, `firefox`, `zen`, `librewolf`, `floorp`, `waterfox`); without it they are tried in that order. The Keychain line is printed only when a Chromium store is about to be opened. When nothing is found, the error lists every browser: not installed, how many profiles had no cookie for the host, or why the store could not be read.

| | Firefox, Zen, LibreWolf, Floorp, Waterfox | Chrome, Edge, Brave, Chromium | Arc |
|---|---|---|---|
| macOS | yes (`~/Library/Application Support/<Firefox, zen, LibreWolf, Floorp, Waterfox>/Profiles`) | yes: the Keychain asks once for the "Safe Storage" password; click Allow | yes |
| Windows | yes (`%APPDATA%\<Mozilla\Firefox, zen, librewolf, Floorp, Waterfox>\Profiles`) | usually no: since Chrome 127 and the matching Edge, cookies are app-bound, which only the browser itself can decrypt. The command says so; paste the cookie in Settings → Sources, or use `--token` if your school allows tokens | no |
| Linux | yes (`~/.mozilla/firefox` with the snap and flatpak sandboxes, `~/.zen` and its flatpak, `~/.librewolf`, `~/.floorp`, `~/.waterfox`) | only with the basic password store (`--password-store=basic`, or no desktop keyring); with GNOME Keyring or KWallet the key is read through `secret-tool` when that works, otherwise the command says the store is locked | no |

Pasting always works: DevTools → Application → Cookies → your Canvas domain, copy the value of `canvas_session` (older instances: `_normandy_session`) into the Canvas card, which has a field for just the value and a list for the cookie name. The Canvas address field accepts a bare host or any page address from that Canvas.

No server at all? See [Local mode](#local-mode).

## Local mode

Local mode runs collected inside the command itself: the same backend the server runs, over a SQLite database on this machine. No server, no Docker, no `.env`. Every command works the same way; the difference is where the data lives.

```sh
collected init --local                 # or --data-dir <path>; default ~/.collected/data
collected demo canvas                  # fixture courses and assignments, to look around (demo clear removes them)
collected courses
collected status                       # "local · <data dir>"
```

The data directory (created `0700`) holds `collected.db`, the encryption key (`.secret_key`, created on first use), the pre-migration snapshots under `backups/`, the daemon's log and the per-source lock files (`sync.lock/`). It is yours to back up or delete. `collected sync <source|all>` runs a source's sync right there and waits for it; `collected connect canvas --token` (or plain `connect canvas` for the browser cookie) stores the Canvas credential in the local database and syncs it. `login` and `auth service-token` have nothing to do in local mode and say so.

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

Without the dashboard open and without a read asking, nothing syncs on its own; `collected daemon install` ([Keep it current](#keep-it-current)) adds the timer that does.

### Google Calendar and Google Tasks: `collected connect google`

```sh
collected connect google               # Google Calendar: opens the consent screen, waits for Google to come back
collected connect google tasks         # Google Tasks, its own consent (the tasks scope only)
collected connect google --no-open     # prints the URL instead of opening a browser
```

No Google Cloud project is needed: the package carries a Google OAuth client of the "Desktop app" kind, and that kind accepts any `http://127.0.0.1:<port>/...` redirect, so the sign-in finishes on whatever loopback port the command (or `collected ui`) is listening on. The command starts the same app `ui` serves on an ephemeral port without the scheduler, opens Google, waits up to three minutes for the browser to land back on it, prints the result (the calendars or lists it found) and stops the listener. The Connect buttons under Settings → Sources in `collected ui` do the same thing from the page. The flow carries PKCE, and the refresh token lands encrypted in the local database like every other credential. Against a server, the command says to use Settings → Sources there: the sign-in has to end where the server's redirect URI points.

A build can ship without the built-in client (the Sources page says so, and `connect google` says so before it listens); then either add your own client to `~/.collected/.env` (below) or use the Google Calendar (iCal) source, which needs no sign-in.

Todoist in local mode takes a pasted API token (Todoist → Settings → Integrations → Developer): `collected connect todoist` prompts for it (or reads it from stdin), stores it and runs the first sync, and the Sources card in `collected ui` takes the same paste. Sign in with Todoist needs a Todoist app of your own, because Todoist registers one exact redirect URL per app and has no loopback exception: register one at `https://developer.todoist.com/appconsole.html` with `http://127.0.0.1:4848/api/todoist/callback` (the `ui` port) and put its id and secret in `~/.collected/.env`.

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
courses import [--list | --all | --term 2026-fall | <rows or Canvas ids>]   turn Canvas enrollments into courses (default: the current term), then sync
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
event add "<title>" --at "<when>" [--for 1h30m | --end "<when>"] [--calendar <id or name>] [--location L] [--note N]   a Google Calendar event
event add "<title>" --on YYYY-MM-DD [--until YYYY-MM-DD]   all day; <when> is "2026-11-03 14:00", "today 14:00", "tomorrow 9:30" or "fri 17:00"
event calendars                             the connected Google calendars, with the default marked
jobs set <job-id> <state> [--notes N] [--next "what" --next-at YYYY-MM-DD]
resync [canvas|gradescope|gcal|todoist|jobs|all]
connect canvas [--browser X] [--domain host] [--dry-run]   read the Canvas session cookie from a browser and send it
connect canvas --token [--domain host] [--dry-run]   or, if your school allows tokens, paste a Canvas access token at the prompt (or pipe it on stdin); checked against Canvas, then saved
connect google [calendar|tasks]             local mode: the Google consent in your browser
connect todoist                             local mode: a Todoist API token at the prompt (or on stdin), then the first sync
quickstart [--agent [--json]]               every step above as a conversation, or as a plan for an agent
```

Local mode only (`collected init --local`):

```
ui [--port 4848] [--no-open]                the dashboard at http://127.0.0.1:<port> until Ctrl-C, syncing in the background
connect google [calendar|tasks] [--no-open] the Google sign-in in your browser, on a temporary loopback port; no project needed
demo <canvas|gradescope|gcal|todoist|gtasks>   load that source's fixture data into the local database
demo clear                                  remove everything the demo loaders created
sync <source|all>                           run a source sync in-process and wait for it (same as resync); bare `sync` runs them all, then the files
--fresh | --stale-ok                        on any read: sync first regardless of age, or never (default: older than freshness.maxAgeMinutes)
```

Canvas, read-only (one GET through the server with its stored session; nothing is ever written to Canvas):

```
canvas ls <course> [modules|files|pages|assignments|announcements]
canvas show <course> syllabus | page <slug> | assignment <id> | announcement <id>
canvas get "<api path>" [--all]
pull <canvas-file-id> --to <folder>
```

File sync, and keeping it all current:

```
files courses                               what the server wants synced and where it lands here
files link <course-id> <path>               root folder for a course
files link <course-id> <target> <path>      one named target (e.g. readings, slides) to a folder
files unlink <course-id> [target]
sync [--dry-run] [--course X] [--no-model]  everything this machine keeps current: in local mode every enabled source, then
                                            the file sync; against a server the file sync alone (--dry-run plans the files, syncs nothing)
status                                      last file sync, what has been placed, and whether the daemon is installed
daemon install [--interval N]               a user timer running `collected sync` every N minutes (15 in local mode, 30 against a server)
daemon status | uninstall                   (install-launchd and uninstall-launchd still work and mean these)
```

This program:

```
--version                                   print the version
upgrade [--dry-run]                         install the newest collected-cli from npm with whatever installed this one
```

A `<course>` is its code (`cs101`), the digits (`101`), or the full id.

## Config file

`~/.collected/agent.json` (override the directory with `COLLECTED_AGENT_HOME`). It holds the server URL (or `local`, with the data directory under `local.dataDir` and `freshness.maxAgeMinutes`), `daemon.intervalMinutes` for the timer, the credential, this machine's name, the cache directory, the per-course folder links, and the optional classifier settings. It is written `0600` and is the only place filesystem paths live; the server never learns them. `state.json` next to it is the program's own memory: what the file sync has placed, and when the version notice last ran and what it saw. Local mode's optional overrides (OAuth clients, `TZ`, `LOG_LEVEL`) go in `~/.collected/.env` next to it, see [above](#collectedenv-overrides-for-local-mode).

`collected auth model` stores a TypeSafe key for the Jev classifier that sorts files the rules cannot place. Skip it to sort by rules only.

## Safety rules the sync follows

- A file is written only under a folder you linked, never anywhere the server names. Targets are validated against the names you configured and the resolved path must stay inside the linked root.
- A file you edited or moved after the sync placed it is never overwritten or removed.
- Downloads follow only `https` redirects to public hosts, with a size cap and a timeout; no auth header crosses a redirect.
- Secrets are read from a prompt or stdin, never from a command-line argument.

## Keep it current

```sh
collected daemon install               # a user-level timer running `collected sync` in the background
collected daemon install --interval 20 # every 20 minutes instead of the default
collected daemon status                # installed or not, loaded or not, the last run and the log's tail
collected daemon uninstall
```

A laptop has two things to keep current: the course files, in either mode, and in local mode the sources in the database as well. Bare `collected sync` is both, in that order, so one timer is enough. What it runs depends on the mode:

- **Local mode**: every enabled source is synced in-process (the same run as `collected sync all`, all sources together, waited for), then the file sync for every course that has it on. Every 15 minutes by default. The log is `<data dir>/daemon.log`.
- **Against a server**: the file sync only; the server keeps its own sources fresh on its scheduler. Every 30 minutes by default. The log is `~/.collected/daemon.log`.

`daemon.intervalMinutes` in `agent.json` sets the period for good and wins over `--interval`; the minimum is 5. macOS gets `~/Library/LaunchAgents/com.collected.sync.plist` (loaded with `launchctl bootstrap gui/$UID`, so it runs while you are logged in); Linux a systemd user service and timer under `~/.config/systemd/user/` (`collected-sync.timer`, enabled with `systemctl --user enable --now`); on Windows the command prints the `schtasks` line to run yourself. A second home set with `COLLECTED_AGENT_HOME` gets a timer of its own (`com.collected.sync.<hash>` / `collected-sync-<hash>`, the hash from that home's path), so trying local mode in `~/.collected-trial` leaves the real install's timer alone. The unit calls the exact binary you ran `install` from, so after moving or upgrading the CLI run `install` again. Nothing secret goes into the unit: credentials live in the database or in `agent.json`, and the unit carries paths only. The log names courses, assignment titles and placed paths, so it is created `0600` before the system does.

`collected status` shows the timer's state in one line next to the last file sync. `collected install-launchd [--interval N]` and `collected uninstall-launchd`, the file sync's old timer commands, still work: they are `daemon install` and `daemon uninstall` under the old names, with a note saying so. A machine that still has the old `com.collected.agent` LaunchAgent gets it unloaded and deleted the next time `daemon install` (or `uninstall`) runs, so the file sync never runs on two timers; its old log, `~/.collected/agent.log`, can be deleted.

## License

AGPL-3.0-only. Source: https://github.com/priyam-k/collected (the `agent/` workspace).
