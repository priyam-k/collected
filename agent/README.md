# collected-cli

The command-line client for [collected](https://github.com/priyam-k/collected), the self-hosted student dashboard. It talks to your own collected server: read what is due, make small edits, browse Canvas read-only, and keep course files synced into folders on this machine.

The dashboard reads are the same data the web app shows (assignments, agenda, grades, announcements, dates, sources, the jobs tracker). The file sync is laptop-only by design: the server knows the *names* of your target folders, this machine knows the paths, and the server never sees file bytes.

## Install

Needs Node 22 or newer.

```sh
npm i -g collected-cli
collected help
```

Two binaries are installed, `collected` and `collected-agent`; they are the same program.

## Set up

```sh
collected init https://collected.example.com     # your server (https; http only for localhost)
collected auth service-token <client-id>          # prompts for the secret; keeps it out of shell history
collected courses                                 # proves the connection
```

`init` writes the config file and prints the next steps. For a server you run locally with `AUTH_DISABLED=true`, use `collected auth helper-key` with the server's `LOCAL_HELPER_KEY` instead of a service token. `collected connect canvas` (reads the Canvas session from your browser and hands it to the server) is being added; until it lands, paste the cookie in Settings → Sources.

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

The same web dashboard a server shows, over the local database. It listens on the loopback address only and asks for no sign-in: anyone who can open the page is already on this machine with access to the data folder, so Settings → Account says so and has nothing to sign out of. While it runs, the scheduler keeps every connected source fresh on its usual cadence (Canvas every 15 minutes, Gradescope every 30, calendars and to-do apps every 5), and `/` goes straight to the board. Against a server, `collected ui` just prints the server's address and opens it. The web build comes from the repository checkout for now (`pnpm --filter web build`); the npm package will carry its own copy.

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

Not there yet: the Google and Todoist sign-in buttons, which need your own OAuth client ids (a `~/.collected/.env` for them is coming in a later release). Until then Todoist takes a pasted API token, and Google Calendar works through its iCal address.

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

A `<course>` is its code (`cs101`), the digits (`101`), or the full id.

## Config file

`~/.collected/agent.json` (override the directory with `COLLECTED_AGENT_HOME`). It holds the server URL (or `local`, with the data directory under `local.dataDir`, `freshness.maxAgeMinutes` and `daemon.intervalMinutes`), the credential, this machine's name, the cache directory, the per-course folder links, and the optional classifier settings. It is written `0600` and is the only place filesystem paths live; the server never learns them.

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
