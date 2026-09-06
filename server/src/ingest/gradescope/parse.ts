import * as cheerio from 'cheerio';
import type { CourseRole } from '@collected/shared';

export interface GsCourse {
  id: string;
  shortname: string;
  name: string;
  term: string;
  role: CourseRole;
  href: string;
}

/**
 * /account: two lists headed "Instructor Courses" and "Student Courses", each grouped by term.
 * Course boxes are anchors to /courses/<id>.
 */
export function parseAccount(html: string): GsCourse[] {
  const $ = cheerio.load(html);
  const out: GsCourse[] = [];
  let role: CourseRole = 'student';
  $('#account-show, body')
    .first()
    .find('h2.pageHeading, .courseList')
    .each((_, el) => {
      const $el = $(el);
      if ($el.is('h2')) {
        const t = $el.text().trim().toLowerCase();
        if (t.startsWith('instructor')) role = 'ta';
        else if (t.startsWith('student')) role = 'student';
        return;
      }
      let term = '';
      $el.children().each((_, child) => {
        const $c = $(child);
        if ($c.hasClass('courseList--term')) {
          term = $c.text().trim();
          return;
        }
        $c.find('a.courseBox').each((_, a) => {
          const href = $(a).attr('href') ?? '';
          const m = href.match(/\/courses\/(\d+)/);
          if (!m) return;
          out.push({
            id: m[1]!,
            shortname: $(a).find('.courseBox--shortname').text().trim(),
            name: $(a).find('.courseBox--name').text().trim(),
            term,
            role,
            href,
          });
        });
      });
    });
  // de-dupe (a course can appear under both roles; keep the instructor entry)
  const seen = new Map<string, GsCourse>();
  for (const c of out) {
    const prev = seen.get(c.id);
    if (!prev || (prev.role === 'student' && c.role === 'ta')) seen.set(c.id, c);
  }
  return [...seen.values()];
}

export type GsSubmissionStatus = 'submitted' | 'no_submission' | 'late' | 'graded' | 'unknown';

export interface GsStudentAssignment {
  id: string | null; // numeric assignment id when linked; null for not-yet-open assignments
  title: string;
  url: string | null;
  status: GsSubmissionStatus;
  statusText: string;
  score: number | null;
  points: number | null;
  releaseAt: string | null;
  dueAt: string | null;
  lateDueAt: string | null;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** ISO string from a Gradescope <time datetime="2026-09-14 23:59:00 -0400"> value. */
export function gsTimeToIso(v: string | undefined | null): string | null {
  if (!v) return null;
  const d = new Date(v.replace(' ', 'T').replace(/ (?=[+-]\d{4}$)/, ''));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Student dashboard: #assignments-student-table. */
export function parseStudentCourse(html: string): GsStudentAssignment[] {
  const $ = cheerio.load(html);
  const out: GsStudentAssignment[] = [];
  $('#assignments-student-table tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const nameCell = $tr.find('th, td').first();
    const link = nameCell.find('a').first();
    const button = nameCell.find('button[data-assignment-id]').first();
    const href = link.attr('href') ?? null;
    const idMatch = href?.match(/\/assignments\/(\d+)/);
    const idFromButton = button.attr('data-assignment-id') ?? null;
    const title = (link.length ? link.text() : button.length ? (button.attr('data-assignment-title') ?? button.text()) : nameCell.text()).replace(/\s+/g, ' ').trim();
    const statusCell = $tr.find('.submissionStatus').first();
    const statusText = statusCell.find('.submissionStatus--text').text().trim() || statusCell.text().replace(/\s+/g, ' ').trim();
    const scoreText = statusCell.find('.submissionStatus--score').text().trim();
    const [scoreStr, pointsStr] = scoreText.split('/').map((s) => s.trim());
    const times = $tr.find('time');
    const hidden = $tr.find('td.hidden-column').map((_, td) => $(td).text().trim()).get();
    const release = times.filter('.submissionTimeChart--releaseDate').first().attr('datetime') ?? hidden[0] ?? null;
    const dueTimes = times.filter('.submissionTimeChart--dueDate');
    const lateEl = dueTimes.filter((_, el) => /late due/i.test($(el).text())).first();
    const primaryDue = dueTimes.filter((_, el) => !/late due/i.test($(el).text())).first();
    const due = primaryDue.attr('datetime') ?? dueTimes.first().attr('datetime') ?? hidden[1] ?? null;
    const lateDue = lateEl.attr('datetime') ?? (dueTimes.length > 1 ? (dueTimes.last().attr('datetime') ?? null) : null);
    let status: GsSubmissionStatus = 'unknown';
    const st = statusText.toLowerCase();
    if (/no submission/.test(st)) status = 'no_submission';
    else if (/late/.test(st)) status = 'late';
    else if (scoreText || /graded/.test(st)) status = 'graded';
    else if (/submitted/.test(st)) status = 'submitted';
    if (!title) return;
    out.push({
      id: idMatch ? idMatch[1]! : idFromButton,
      title,
      url: href,
      status,
      statusText,
      score: num(scoreStr),
      points: num(pointsStr),
      releaseAt: gsTimeToIso(release),
      dueAt: gsTimeToIso(due),
      lateDueAt: gsTimeToIso(lateDue),
    });
  });
  return out;
}

export interface GsInstructorAssignment {
  id: string;
  title: string;
  url: string | null;
  totalPoints: number | null;
  releaseAt: string | null;
  dueAt: string | null;
  hardDueAt: string | null;
  numActiveSubmissions: number;
  gradingProgress: number; // 0..100
  isPublished: boolean;
  openRegradeRequests: number;
}

/**
 * Instructor pages render the assignments table with React; the data is embedded as JSON in
 * data-react-props on the AssignmentsTable mount point. Dates are local wall-clock in the course
 * timezone (props.timezone.identifier), e.g. "2026-09-14T23:59".
 */
export function parseInstructorAssignments(html: string): { assignments: GsInstructorAssignment[]; timezone: string | null } {
  const $ = cheerio.load(html);
  const el = $('[data-react-class="AssignmentsTable"]').first();
  if (!el.length) return { assignments: [], timezone: null };
  let props: {
    table_data?: Array<{
      id?: string;
      type?: string;
      title?: string;
      url?: string;
      total_points?: string | number | null;
      submission_window?: { release_date?: string | null; due_date?: string | null; hard_due_date?: string | null } | null;
      num_active_submissions?: number;
      grading_progress?: number;
      is_published?: boolean;
      open_regrade_request_count?: number;
    }>;
    timezone?: { identifier?: string };
  };
  try {
    props = JSON.parse(el.attr('data-react-props') ?? '{}');
  } catch {
    return { assignments: [], timezone: null };
  }
  const tz = props.timezone?.identifier ?? null;
  const assignments: GsInstructorAssignment[] = [];
  for (const row of props.table_data ?? []) {
    if (row.type && row.type !== 'assignment') continue;
    const id = (row.id ?? '').replace(/^assignment_/, '');
    if (!id) continue;
    assignments.push({
      id,
      title: row.title ?? `Assignment ${id}`,
      url: row.url ?? null,
      totalPoints: row.total_points == null ? null : Number(row.total_points),
      releaseAt: wallClockToIso(row.submission_window?.release_date, tz),
      dueAt: wallClockToIso(row.submission_window?.due_date, tz),
      hardDueAt: wallClockToIso(row.submission_window?.hard_due_date, tz),
      numActiveSubmissions: row.num_active_submissions ?? 0,
      gradingProgress: row.grading_progress ?? 0,
      isPublished: !!row.is_published,
      openRegradeRequests: row.open_regrade_request_count ?? 0,
    });
  }
  return { assignments, timezone: tz };
}

/** "2026-09-14T23:59" in an IANA zone → ISO UTC. Falls back to treating it as local server time. */
export function wallClockToIso(v: string | null | undefined, tz: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
  if (!tz) return new Date(y, mo - 1, d, h, mi, s || 0).toISOString();
  // Find the UTC instant whose wall clock in tz equals the given fields (two-pass DST correction).
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t).toISOString();
}
