# collected-cli

The command-line client for [collected](https://github.com/<you>/collected), the self-hosted student dashboard. It talks to your own collected server: read what is due, make small edits, browse Canvas read-only, and keep course files synced into folders on this machine.

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

`~/.collected/agent.json` (override the directory with `COLLECTED_AGENT_HOME`). It holds the server URL, the credential, this machine's name, the cache directory, the per-course folder links, and the optional classifier settings. It is written `0600` and is the only place filesystem paths live; the server never learns them.

`collected auth model` stores a TypeSafe key for the Jev classifier that sorts files the rules cannot place. Skip it to sort by rules only.

## Safety rules the sync follows

- A file is written only under a folder you linked, never anywhere the server names. Targets are validated against the names you configured and the resolved path must stay inside the linked root.
- A file you edited or moved after the sync placed it is never overwritten or removed.
- Downloads follow only `https` redirects to public hosts, with a size cap and a timeout; no auth header crosses a redirect.
- Secrets are read from a prompt or stdin, never from a command-line argument.

## launchd

`collected install-launchd --interval 30` writes `~/Library/LaunchAgents/com.collected.agent.plist` and loads it, so the sync runs every 30 minutes while you are logged in; the log is `~/.collected/agent.log`. `collected uninstall-launchd` removes it. On Linux use a user cron entry or a systemd timer that runs `collected sync`.

## License

AGPL-3.0-only. Source: https://github.com/<you>/collected (the `agent/` workspace).
