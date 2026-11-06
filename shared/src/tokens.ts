/*
 * What an API token may touch. A token is scoped per area and per direction: `read` lists and shows, `write` also
 * adds, edits, closes and resyncs. An area the token does not name is closed to it. `null` scopes mean everything a
 * token identity may do at all (the machine deny list in server/src/api/index.ts still applies: no credentials, no
 * settings, no layout, no tokens, no import/export, whatever the scopes say).
 *
 * The areas follow what a person sees, not the route tree: Gradescope grades sit under `courses` with Canvas, and
 * Google Tasks under `tasks` with Todoist, because a token for "my coursework" or "my to-do list" is the thing someone
 * means to hand out. server/src/api/scopes.ts maps each route to one of these.
 */

export const TOKEN_AREAS = ['courses', 'jobs', 'calendar', 'tasks'] as const;
export type TokenArea = (typeof TOKEN_AREAS)[number];
export type TokenAccess = 'read' | 'write';
/** Area → access. A missing area means no access. */
export type TokenScopes = Partial<Record<TokenArea, TokenAccess>>;

export const TOKEN_AREA_INFO: Record<TokenArea, { label: string; covers: string; read: string; write: string }> = {
  courses: {
    label: 'Courses',
    covers: 'Courses, assignments, grades, announcements, dates, Canvas browsing and course files (Canvas and Gradescope).',
    read: 'list courses, assignments, grades, announcements and files; browse Canvas read-only',
    write: 'mark assignments done, edit schedules, notes, links and dates, import courses, resync',
  },
  jobs: {
    label: 'Jobs',
    covers: 'The job feed, the applications tracker and its stages.',
    read: 'list and search the feed and the tracker',
    write: 'add, stage and edit applications, mark feed jobs seen, edit stages',
  },
  calendar: {
    label: 'Calendar',
    covers: 'Google Calendar events on the agenda.',
    read: 'see events on the agenda',
    write: 'create events, resync the calendar',
  },
  tasks: {
    label: 'Tasks',
    covers: 'Todoist and Google Tasks: open tasks and the to-do sync status.',
    read: 'list open tasks and the sync status',
    write: 'add and close tasks',
  },
};

/** `null` or every area at `write`: the token is unrestricted (within what a token may do at all). */
export function isFullScopes(scopes: TokenScopes | null | undefined): boolean {
  if (!scopes) return true;
  return TOKEN_AREAS.every((a) => scopes[a] === 'write');
}

/** Whether `scopes` grant `access` on `area`; `write` implies `read`. */
export function scopeGrants(scopes: TokenScopes | null | undefined, area: TokenArea, access: TokenAccess): boolean {
  if (!scopes) return true;
  const have = scopes[area];
  if (!have) return false;
  return access === 'read' || have === 'write';
}

/** Whether `scopes` grant `read` on at least one area: the smallest a usable token can be. */
export function scopeGrantsAny(scopes: TokenScopes | null | undefined): boolean {
  if (!scopes) return true;
  return TOKEN_AREAS.some((a) => !!scopes[a]);
}

/** Drops unknown areas and values; an empty result is `{}` (unusable), which callers reject. */
export function normalizeScopes(input: unknown): TokenScopes | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') return {};
  const out: TokenScopes = {};
  for (const a of TOKEN_AREAS) {
    const v = (input as Record<string, unknown>)[a];
    if (v === 'read' || v === 'write') out[a] = v;
  }
  return isFullScopes(out) ? null : out;
}

/** "everything", or "courses: read · jobs: read, write"-style text for lists and the CLI. */
export function describeScopes(scopes: TokenScopes | null | undefined): string {
  if (isFullScopes(scopes)) return 'everything';
  const parts = TOKEN_AREAS.filter((a) => scopes![a]).map((a) => `${a}: ${scopes![a] === 'write' ? 'read, write' : 'read'}`);
  return parts.length ? parts.join(' · ') : 'nothing';
}

/** The compact form the CLI accepts and prints: `courses:rw,jobs:r`; `all` for unrestricted. */
export function formatScopes(scopes: TokenScopes | null | undefined): string {
  if (isFullScopes(scopes)) return 'all';
  const parts = TOKEN_AREAS.filter((a) => scopes![a]).map((a) => `${a}:${scopes![a] === 'write' ? 'rw' : 'r'}`);
  return parts.length ? parts.join(',') : 'none';
}

/** Parses `courses:rw,jobs:r` (also `courses=rw`, `jobs:read`, `tasks:write`); `all` → null. Throws on anything else. */
export function parseScopes(text: string): TokenScopes | null {
  const t = text.trim().toLowerCase();
  if (!t || t === 'all' || t === 'everything') return null;
  const out: TokenScopes = {};
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    const m = /^([a-z]+)[:=](r|rw|w|read|write|read-write|readwrite)$/.exec(part);
    if (!m) throw new Error(`cannot read scope "${part}": expected <area>:r or <area>:rw, areas ${TOKEN_AREAS.join(', ')}, or "all"`);
    const area = m[1] as TokenArea;
    if (!TOKEN_AREAS.includes(area)) throw new Error(`unknown scope area "${area}": one of ${TOKEN_AREAS.join(', ')}`);
    const access: TokenAccess = m[2] === 'r' || m[2] === 'read' ? 'read' : 'write';
    // The wider grant wins when an area is named twice.
    if (out[area] !== 'write') out[area] = access;
  }
  return isFullScopes(out) ? null : out;
}
