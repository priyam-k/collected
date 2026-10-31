/*
 * The quickstart's steps as data: `collected quickstart` walks a person through them at the terminal, and
 * `collected quickstart --agent` prints them as a plan for an AI agent that runs the CLI on the person's behalf.
 * One list, so the two never say different things, and it ships with the CLI, so the plan always matches the
 * commands installed (DECISIONS 062). The website says only "install, then run `collected quickstart --agent`".
 */

export type QuickstartStepId = 'where' | 'canvas' | 'courses' | 'google' | 'todoist' | 'daemon' | 'finish';

export interface QuickstartStep {
  id: QuickstartStepId;
  title: string;
  /** One sentence: what the step does and why. Said before the step runs, in both modes. */
  why: string;
  /** The exact command(s), nothing else. */
  command: string;
  /** A variant or what the command prompts for; prose, may hold code spans. */
  note?: string;
  /** What to ask the person before running it. */
  ask?: string;
  /** What to do when the command fails or cannot run here. */
  fallback?: string;
}

export const SKILL_URL = 'https://raw.githubusercontent.com/priyam-k/collected/main/skills/collected/SKILL.md';
export const SKILL_HOME = '~/.claude/skills/collected/SKILL.md';

export const QUICKSTART_STEPS: readonly QuickstartStep[] = [
  {
    id: 'where',
    title: 'Where collected runs',
    why: 'collected runs whole inside this command, over a database in ~/.collected with nothing to host, or talks to a collected server you already run.',
    command: 'collected init --local',
    note: 'a server instead: `collected init https://your.server`, then `collected login`',
    ask: 'Run everything on this computer, or connect to a collected server you already have? Local unless they name a server.',
    fallback: 'A config that already exists is kept; `collected init --force ...` replaces it.',
  },
  {
    id: 'canvas',
    title: 'Canvas',
    why: 'Reads the Canvas session cookie from the browser you are signed in with and stores it, so assignments, grades and announcements sync; on macOS the Keychain asks once, click Allow (not Always Allow).',
    command: 'collected connect canvas',
    ask: 'Which browser they are signed in to Canvas with, if it is not the default one; nothing else.',
    fallback:
      'Paste the cookie instead: in that browser, DevTools → Application → Cookies → your Canvas domain, copy the value of canvas_session (older schools: _normandy_session) into Settings → Sources → Canvas, which takes the cookie name and the value. If the school allows personal access tokens, `collected connect canvas --token` prompts for one (Canvas → Account → Settings → Approved Integrations → New Access Token).',
  },
  {
    id: 'courses',
    title: 'Courses',
    why: 'Turns the active Canvas enrollments into courses on the board, then syncs Canvas into them; the board is empty until this runs once.',
    command: 'collected courses import --list; collected courses import',
    note: 'the second imports the current term; `--all`, row numbers or Canvas ids pick otherwise',
    ask: 'Show the list and ask which to import; the default is every current-term enrollment.',
    fallback: 'Skipped when courses already exist or Canvas is not connected.',
  },
  {
    id: 'google',
    title: 'Google Calendar and Google Tasks',
    why: 'Each opens the browser once for Google\'s consent and stores the refresh token locally; both can be done later from Settings → Sources in `collected ui`.',
    command: 'collected connect google calendar; collected connect google tasks',
    ask: 'Yes or no, separately, before each consent screen.',
    fallback: 'Local mode only: against a server, Settings → Sources on the server does it. A build without a Google client says so; the Google Calendar (iCal) source needs no sign-in.',
  },
  {
    id: 'todoist',
    title: 'Todoist',
    why: 'A Todoist API token puts tasks on the board and lets assignments push to Todoist.',
    command: 'collected connect todoist',
    note: 'prompts for the token: Todoist → Settings → Integrations → Developer',
    ask: 'Whether they use Todoist; skip if not.',
    fallback: 'Local mode only: against a server, paste it under Settings → Sources → Todoist there.',
  },
  {
    id: 'daemon',
    title: 'Keep it current',
    why: 'Installs a user timer (LaunchAgent on macOS, systemd user timer on Linux) that runs `collected sync` every 15 minutes in local mode or 30 against a server, logging to daemon.log in the data directory, so reads are fresh without the dashboard open.',
    command: 'collected daemon install',
    ask: 'Whether to install the timer.',
    fallback: 'Without it, a read syncs a stale source itself and `collected ui` syncs while open.',
  },
  {
    id: 'finish',
    title: 'See it',
    why: 'Shows the next three days and names the commands you will use most.',
    command: 'collected agenda --days 3',
    ask: 'Whether to open the dashboard (`collected ui`, http://127.0.0.1:4848, runs until Ctrl-C); do not start it unasked.',
  },
];

const DESCRIPTION =
  'collected is an open-source student dashboard and CLI: Canvas, Gradescope, Google Calendar, Todoist and Google Tasks on one board, readable from the terminal by people and by agents like you. ' +
  'It runs whole on this computer (local mode, data in ~/.collected, nothing to host) or against a server the person hosts. ' +
  'Every read takes `--json`. `collected quickstart` is this same plan as an interactive wizard; `collected help` lists everything else.';

/** The Markdown plan for an agent: under 60 lines, built from the step list. */
export function agentPlan(version: string): string {
  const lines: string[] = [
    `# Set up collected (plan for an agent · collected-cli ${version})`,
    '',
    DESCRIPTION,
    '',
    `Before anything, save the skill so later sessions can use collected: fetch ${SKILL_URL} to where you keep skills (Claude Code: ${SKILL_HOME}). If you cannot write there, ask the user to.`,
    '',
    'Rules:',
    '- Ask the laptop-or-server question up front; ask yes/no before each Google consent and before installing the timer.',
    '- Say what each step does in one line before running it, and let the user skip it. A step that fails is reported and the next one runs.',
    '- Never ask the user to paste secrets into chat; the CLI prompts for them itself, so run those commands with the terminal attached.',
    '- Do not run `collected ui` unless asked. Re-running any step is safe: it reports what is already done.',
    '',
    'Steps, in order:',
    '',
  ];
  QUICKSTART_STEPS.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.title}.** ${s.why}`);
    if (s.ask) lines.push(`   Ask first: ${s.ask}`);
    lines.push(`   Run: \`${s.command}\`${s.note ? ` (${s.note})` : ''}`);
    if (s.fallback) lines.push(`   If it cannot: ${s.fallback}`);
    lines.push('');
  });
  lines.push('When done, tell the user the three commands they will use most: `collected agenda`, `collected todo`, `collected ui`; `collected help` has the rest.');
  return lines.join('\n');
}

/** The same plan for tools that prefer structure. */
export function agentPlanJson(version: string): { version: string; skill: { url: string; saveTo: string }; steps: QuickstartStep[] } {
  return { version, skill: { url: SKILL_URL, saveTo: SKILL_HOME }, steps: QUICKSTART_STEPS.map((s) => ({ ...s })) };
}
