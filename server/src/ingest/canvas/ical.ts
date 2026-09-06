import ical from 'node-ical';
import { eq } from 'drizzle-orm';
import { sourceConfigSchemas } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { courses, type CourseRow, type NewItemRow } from '../../db/schema.js';
import { upsertItems } from '../../lib/items.js';
import { getSourceConfig } from '../../lib/sources.js';
import { isoOrNull } from '../../lib/time.js';
import { NotConfiguredError, type Ingester } from '../types.js';
import { normCode } from './map.js';

interface VEvent {
  type: 'VEVENT';
  uid?: string;
  summary?: string;
  description?: string;
  url?: string;
  start?: Date;
  end?: Date;
  datetype?: 'date' | 'date-time';
}

/**
 * Canvas iCal feeds: UIDs look like `event-assignment-123`, `event-calendar-event-456`,
 * summaries end with ` [Course name]`. No submission state, which is why this is only a fallback.
 */
export function parseCanvasIcs(text: string, ours: CourseRow[]): NewItemRow[] {
  const data = ical.sync.parseICS(text) as Record<string, unknown>;
  const out: NewItemRow[] = [];
  const byCode = ours.filter((c) => !c.archived).map((c) => ({ c, code: normCode(c.code) }));
  for (const v of Object.values(data)) {
    const ev = v as VEvent;
    if (ev?.type !== 'VEVENT' || !ev.uid) continue;
    const summary = ev.summary ?? '';
    const m = summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const title = (m ? m[1] : summary)!.trim() || 'Untitled';
    const context = m ? m[2]! : '';
    const contextCode = normCode(context.split(/[:\s-]/)[0]);
    const course = byCode.find((x) => x.code === contextCode || normCode(context).startsWith(x.code))?.c ?? null;
    const asg = ev.uid.match(/^event-assignment(?:-override)?-(\d+)/);
    const cal = ev.uid.match(/^event-calendar-event-(\d+)/);
    const allDay = ev.datetype === 'date';
    if (asg) {
      out.push({
        id: `canvas_ical:assignment:${asg[1]}`,
        source: 'canvas_ical',
        externalId: `assignment:${asg[1]}`,
        kind: 'assignment',
        courseId: course?.id ?? null,
        title,
        description: ev.description?.slice(0, 2000) ?? null,
        url: ev.url ?? null,
        dueAt: isoOrNull(ev.start ?? null),
        startsAt: null,
        endsAt: null,
        allDay,
        status: 'open',
        points: null,
        score: null,
        labels: [],
        raw: { context, uid: ev.uid },
      });
    } else {
      const id = cal ? cal[1]! : ev.uid.replace(/[^a-zA-Z0-9_-]/g, '_');
      out.push({
        id: `canvas_ical:event:${id}`,
        source: 'canvas_ical',
        externalId: `event:${id}`,
        kind: 'event',
        courseId: course?.id ?? null,
        title,
        description: ev.description?.slice(0, 2000) ?? null,
        url: ev.url ?? null,
        startsAt: isoOrNull(ev.start ?? null),
        endsAt: isoOrNull(ev.end ?? null),
        dueAt: null,
        allDay,
        status: 'open',
        points: null,
        score: null,
        labels: [],
        raw: { context, uid: ev.uid },
      });
    }
  }
  return out;
}

export const canvasIcalIngester: Ingester = {
  id: 'canvas_ical',
  intervalMinutes: 60,
  timeoutMs: 60_000,
  async run(ctx, signal) {
    const config = await getSourceConfig<{ url: string }>(ctx, 'canvas_ical');
    if (!config?.url) throw new NotConfiguredError('Canvas iCal feed URL not set');
    const { url } = sourceConfigSchemas.canvas_ical.parse(config);
    const res = await fetch(url, { signal, headers: { 'User-Agent': 'collected/0.1' } });
    if (!res.ok) throw new Error(`iCal fetch ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('iCal URL did not return a calendar');
    const ours = await ctx.db.select().from(courses).where(eq(courses.archived, false));
    const rows = parseCanvasIcs(text, ours);
    const r = await upsertItems(ctx, 'canvas_ical', rows, []);
    return { counts: { events: rows.length, upserted: r.upserted, created: r.created, deleted: r.deleted } };
  },
};
