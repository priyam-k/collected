import type { Meeting } from '@collected/shared';

/* Output helpers for the `collected` commands: plain tables for people, parsing for the few structured inputs. */

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Left-aligned columns, long cells cut. No box drawing: it has to read well in a transcript and in a terminal. */
export function table(headers: string[], rows: (string | number | null | undefined)[][], maxCell = 64): string {
  if (!rows.length) return '(none)';
  const cells = rows.map((r) => r.map((c) => cut(String(c ?? '').replace(/\s+/g, ' ').trim(), maxCell)));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

/** "Mon Oct 5, 11:59 PM" in this machine's timezone. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Local YYYY-MM-DD, for grouping by day. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Canvas HTML → readable text: headings, list items, and links survive; scripts, styles and tags do not. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return !t || t === href ? href : `${t} (${href})`;
    })
    .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<p\b[^>]*>/gi, '\n\n')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/ul|\/ol)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()]!;
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    })
    .split('\n')
    .map((l) => l.trimEnd()) // not /[ \t]+\n/: that is quadratic on a long run of spaces (SECURITY-REVIEW 1.3)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Canvas file ids a body links to, with the link text, so a reader can `collected pull` one. */
export function linkedFiles(html: string | null | undefined): { fileId: string; text: string }[] {
  const out = new Map<string, string>();
  for (const m of (html ?? '').matchAll(/<a\b[^>]*href="[^"]*\/files\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.replace(/<[^>]+>/g, '').trim());
  }
  return [...out].map(([fileId, text]) => ({ fileId, text }));
}

const DAYS: Record<string, Meeting['day']> = { mon: 'mon', monday: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue', wed: 'wed', wednesday: 'wed', thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat', sun: 'sun', sunday: 'sun' };
const hhmm = (t: string): string => {
  const [h, m] = t.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${m}`;
};

/** "mon,wed 14:00-14:50 @ CHE 2110" → one meeting per day. Days by name, comma- or slash-separated; the room is optional. */
export function parseMeetings(spec: string): Meeting[] {
  const m = spec.trim().match(/^([A-Za-z,/\s]+?)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:\s*@\s*(.+))?$/);
  if (!m) throw new Error(`can't read "${spec}"; expected e.g. "mon,wed 14:00-14:50 @ CHE 2110"`);
  const days = m[1]!.split(/[,/\s]+/).filter(Boolean).map((d) => {
    const day = DAYS[d.toLowerCase()];
    if (!day) throw new Error(`unknown day "${d}" in "${spec}"`);
    return day;
  });
  const start = hhmm(m[2]!);
  const end = hhmm(m[3]!);
  if (end <= start) throw new Error(`"${spec}": the end time must be after the start`);
  const location = m[4]?.trim();
  return days.map((day) => ({ day, start, end, ...(location ? { location } : {}) }));
}

const DAY_INDEX: Record<Meeting['day'], number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WHEN_HELP = 'YYYY-MM-DD HH:MM, today 14:00, tomorrow 9:30 or fri 17:00';

const clock = (t: string, input: string): { h: number; m: number } => {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
  if (!m) throw new Error(`can't read "${input}" as a time; use ${WHEN_HELP}`);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59 || (ap && (Number(m[1]) < 1 || Number(m[1]) > 12))) throw new Error(`"${input}": ${t.trim()} is not a time of day`);
  return { h, m: min };
};

/**
 * A moment in this machine's timezone: "2026-11-03 14:00", "2026-11-03T14:00", "today 14:00", "tomorrow 9:30",
 * or a weekday and time ("fri 17:00": the next Friday, today if that time is still ahead).
 */
export function parseWhen(input: string, now = new Date()): Date {
  const s = input.trim();
  const abs = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\s*(.+))$/);
  if (abs) {
    const { h, m } = clock(abs[4]!, input);
    const d = new Date(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3]), h, m);
    if (d.getFullYear() !== Number(abs[1]) || d.getMonth() !== Number(abs[2]) - 1 || d.getDate() !== Number(abs[3])) throw new Error(`"${input}": ${abs[1]}-${abs[2]}-${abs[3]} is not a date`);
    return d;
  }
  const rel = s.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!rel) throw new Error(`can't read "${input}" as a time; use ${WHEN_HELP}`);
  const word = rel[1]!.toLowerCase();
  const { h, m } = clock(rel[2]!, input);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (word === 'today') return d;
  if (word === 'tomorrow') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m);
  const day = DAYS[word];
  if (!day) throw new Error(`can't read "${input}" as a time; use ${WHEN_HELP}`);
  let ahead = (DAY_INDEX[day] - now.getDay() + 7) % 7;
  if (ahead === 0 && d <= now) ahead = 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + ahead, h, m);
}

/** "30m", "1h", "1h30m" → minutes. Days are not a duration a timed event takes. */
export function parseDuration(spec: string): number {
  const m = spec.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?$/i);
  const minutes = m && (m[1] || m[2]) ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0;
  if (!minutes) throw new Error(`can't read "${spec}" as a duration; use 30m, 1h or 1h30m`);
  return minutes;
}

const DAY_LABEL: Record<Meeting['day'], string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** "lecture Mon/Wed 14:00–14:50 @ CHE 2110; lab Fri 08:00–10:00" */
export function describeSchedule(schedule: Record<string, Meeting[]>): string {
  const parts: string[] = [];
  for (const [kind, meetings] of Object.entries(schedule)) {
    const groups = new Map<string, Meeting['day'][]>();
    for (const mt of meetings) {
      const k = `${mt.start}–${mt.end}${mt.location ? ` @ ${mt.location}` : ''}`;
      groups.set(k, [...(groups.get(k) ?? []), mt.day]);
    }
    for (const [k, days] of groups) parts.push(`${kind} ${days.map((d) => DAY_LABEL[d]).join('/')} ${k}`);
  }
  return parts.join('; ') || '(none)';
}
