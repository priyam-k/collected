import { and, eq, inArray, isNull, notInArray, type SQL } from 'drizzle-orm';
import type { SourceId } from '@collected/shared';
import type { AppContext } from '../context.js';
import { courseContent, items, type NewItemRow } from '../db/schema.js';
import { nowIso } from './time.js';
import type { ContentRow } from '../ingest/canvas/map.js';

export interface UpsertResult {
  upserted: number;
  created: number;
  deleted: number;
}

/**
 * Upserts rows by id and soft-deletes rows of the same source that were not seen, within `scope`
 * (extra conditions such as kind='assignment' and courseId IN tracked). Restores rows that come back.
 *
 * With zero rows the soft-delete is skipped unless `opts.allowEmpty`: an upstream that answers nothing is far
 * more often broken than empty, and the push sync treats a deleted assignment as "delete the task".
 */
export async function upsertItems(ctx: AppContext, source: SourceId, rows: NewItemRow[], scope?: SQL[], opts: { allowEmpty?: boolean } = {}): Promise<UpsertResult> {
  const now = nowIso();
  let created = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const res = await ctx.db
      .insert(items)
      .values({ ...r, source, firstSeenAt: now, updatedAt: now, deletedAt: null })
      .onConflictDoUpdate({
        target: items.id,
        set: {
          kind: r.kind,
          courseId: r.courseId ?? null,
          title: r.title,
          description: r.description ?? null,
          url: r.url ?? null,
          startsAt: r.startsAt ?? null,
          endsAt: r.endsAt ?? null,
          dueAt: r.dueAt ?? null,
          allDay: r.allDay ?? false,
          status: r.status ?? 'open',
          points: r.points ?? null,
          score: r.score ?? null,
          labels: r.labels ?? [],
          raw: r.raw ?? {},
          updatedAt: now,
          deletedAt: null,
        },
      })
      .returning({ firstSeenAt: items.firstSeenAt });
    if (res[0]?.firstSeenAt === now) created++;
  }
  let deleted = 0;
  if (scope && !seen.size && !opts.allowEmpty) {
    ctx.log.warn({ source }, 'upstream returned nothing; keeping existing rows instead of soft-deleting them');
  } else if (scope) {
    const conds = [eq(items.source, source), isNull(items.deletedAt), ...scope];
    if (seen.size) conds.push(notInArray(items.id, [...seen]));
    const gone = await ctx.db.update(items).set({ deletedAt: now }).where(and(...conds)).returning({ id: items.id });
    deleted = gone.length;
  }
  return { upserted: seen.size, created, deleted };
}

/** Full replace of course_content for (courseId, kinds). */
export async function replaceCourseContent(ctx: AppContext, courseId: string, kinds: string[], rows: ContentRow[]): Promise<number> {
  const now = nowIso();
  const keep = new Set<string>();
  for (const r of rows) {
    keep.add(r.id);
    await ctx.db
      .insert(courseContent)
      .values({ ...r, updatedAt: now })
      .onConflictDoUpdate({
        target: courseContent.id,
        set: { moduleName: r.moduleName, title: r.title, url: r.url, position: r.position, raw: r.raw, updatedAt: now },
      });
  }
  const conds = [eq(courseContent.courseId, courseId), inArray(courseContent.kind, kinds)];
  if (keep.size) conds.push(notInArray(courseContent.id, [...keep]));
  await ctx.db.delete(courseContent).where(and(...conds));
  return rows.length;
}
