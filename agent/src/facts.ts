import path from 'node:path';
import type { EffectiveItem } from '@collected/shared';
import { writeIfChanged } from './place.js';

/*
 * Course facts for local tools: what is due when, recent announcements, the syllabus. PDFs rarely carry due dates;
 * collected already has them from Canvas and Gradescope. Written as Markdown because the readers grep it. Nothing
 * here has a "generated at" line, so an unchanged course rewrites nothing.
 */

export interface CourseContentRow {
  kind: string;
  title: string;
  url: string | null;
  raw: Record<string, unknown>;
}

const cell = (s: string | number | null | undefined): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** "Thu, Oct 8, 2026, 11:59 PM EDT" in this machine's timezone. */
export function localTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

const statusOf = (a: EffectiveItem): string => {
  if (a.status === 'graded') return 'graded';
  if (a.status === 'late') return 'submitted late';
  if (a.status === 'submitted') return 'submitted';
  if (a.status === 'missing') return 'missing';
  if (a.effectiveDone) return 'done';
  return a.dueAt && new Date(a.dueAt) < new Date() ? 'past due, not submitted' : 'open';
};

export function renderAssignments(courseCode: string, items: EffectiveItem[]): string {
  const list = items.slice().sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.title.localeCompare(b.title));
  const rows = list.map((a) => {
    const submit = ((a.raw as { submissionTypes?: string[] }).submissionTypes ?? []).join(', ');
    const score = a.score != null ? `${a.score}${a.points != null ? ` / ${a.points}` : ''}` : '';
    return `| ${cell(a.title)} | ${cell(localTime(a.dueAt))} | ${cell(a.dueAt)} | ${cell(a.points)} | ${statusOf(a)} | ${score} | ${cell(a.source)}${a.linkedIds.length ? ' (+linked)' : ''} | ${cell(submit)} | ${a.url ? `[open](${a.url})` : ''} |`;
  });
  const described = list.filter((a) => a.description && a.description.trim());
  return [
    `# ${courseCode} · assignments`,
    '',
    `From Canvas and Gradescope via collected, ${list.length} assignment${list.length === 1 ? '' : 's'}, soonest due first. Due times are local to this machine; the ISO column is UTC. Status is the source's own (Canvas submission state, Gradescope status). Rewritten by collected-agent on every sync.`,
    '',
    '| Assignment | Due (local) | Due (UTC, ISO) | Points | Status | Score | Source | Submit via | Link |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...(described.length
      ? [
          '## Descriptions',
          '',
          'Plain text from the assignment page, cut at 2000 characters by collected. The posted handout file, when there is one, is the full text.',
          '',
          ...described.flatMap((a) => [`### ${a.title}`, '', `Due: ${localTime(a.dueAt) || 'no due date'}${a.points != null ? ` · ${a.points} points` : ''}`, '', a.description!.trim(), '']),
        ]
      : []),
  ].join('\n');
}

export function renderAnnouncements(courseCode: string, items: EffectiveItem[], limit = 10): string {
  const list = items
    .slice()
    .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
    .slice(0, limit);
  return [
    `# ${courseCode} · announcements`,
    '',
    `The ${list.length} most recent Canvas announcement${list.length === 1 ? '' : 's'}, newest first. Rewritten by collected-agent on every sync.`,
    '',
    ...list.flatMap((a) => [`## ${a.title}`, '', `${localTime(a.startsAt)}${a.url ? ` · [open](${a.url})` : ''}`, '', (a.description ?? '').trim(), '']),
  ].join('\n');
}

export function renderSyllabus(courseCode: string, row: CourseContentRow): string {
  const text = String((row.raw as { text?: string }).text ?? '').trim();
  return [`# ${courseCode} · syllabus`, '', `The Canvas syllabus page as text${row.url ? ` ([open](${row.url}))` : ''}. Rewritten by collected-agent when it changes.`, '', text, ''].join('\n');
}

/** Writes assignments.md, announcements.md and syllabus.md into `dir`; returns the files that changed. */
export function writeFacts(dir: string, courseCode: string, assignments: EffectiveItem[], announcements: EffectiveItem[], content: CourseContentRow[]): string[] {
  const changed: string[] = [];
  const put = (name: string, body: string) => {
    if (writeIfChanged(path.join(dir, name), body)) changed.push(name);
  };
  put('assignments.md', renderAssignments(courseCode, assignments));
  if (announcements.length) put('announcements.md', renderAnnouncements(courseCode, announcements));
  const syllabus = content.find((r) => r.kind === 'syllabus');
  if (syllabus && String((syllabus.raw as { text?: string }).text ?? '').trim()) put('syllabus.md', renderSyllabus(courseCode, syllabus));
  return changed;
}
