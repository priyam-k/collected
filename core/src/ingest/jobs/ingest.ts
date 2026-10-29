import { eq, ne, sql } from 'drizzle-orm';
import { jobsFilterSchema, type JobsSource } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { jobState, jobs } from '../../db/schema.js';
import { assertAllowedOutboundUrl, MB, readJson, safeUrlForLog, withTimeout } from '../../lib/http.js';
import { getSettingParsed } from '../../lib/settings.js';
import { getSourceRow } from '../../lib/sources.js';
import { nowIso } from '../../lib/time.js';
import { compileFilter } from './filter.js';
import { NotConfiguredError, type Ingester } from '../types.js';

/** Shape of one entry in SimplifyJobs' .github/scripts/listings.json */
export interface SimplifyListing {
  id: string;
  source?: string;
  category?: string | null;
  company_name: string;
  company_url?: string;
  title: string;
  active: boolean;
  is_visible?: boolean;
  terms?: string[];
  date_posted?: number; // unix seconds
  date_updated?: number;
  url: string;
  locations?: string[];
  sponsorship?: string | null;
  degrees?: string[];
}

export const DEFAULT_JOB_SOURCES: JobsSource[] = [
  { id: 'simplify', url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json' },
];

const epochToIso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

/** The Simplify feed is ~16k rows, a few MB. */
export const MAX_FEED_BYTES = 40 * MB;

export async function fetchListings(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<SimplifyListing[]> {
  assertAllowedOutboundUrl(url, 'a job feed URL');
  const res = await fetchImpl(url, { signal: withTimeout(signal, 60_000), headers: { 'User-Agent': 'collected/0.1 (+personal dashboard)' } });
  if (!res.ok) throw new Error(`listings fetch ${res.status} for ${safeUrlForLog(url)}`);
  const data = await readJson(res, MAX_FEED_BYTES);
  if (!Array.isArray(data)) throw new Error(`listings at ${safeUrlForLog(url)} is not an array`);
  return data as SimplifyListing[];
}

const httpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Columns that come from the feed. A listing is rewritten only when one of these differs from the stored row. */
type ListingValues = {
  id: string;
  source: string;
  externalId: string;
  company: string;
  title: string;
  locations: string[];
  url: string;
  terms: string[];
  sponsorship: string | null;
  degrees: string[];
  category: string | null;
  postedAt: string | null;
  active: boolean;
  visible: boolean;
  matchesFilter: boolean;
};

const fingerprint = (v: Omit<ListingValues, 'id' | 'source' | 'externalId'>) =>
  JSON.stringify([v.company, v.title, v.locations, v.url, v.terms, v.sponsorship, v.degrees, v.category, v.postedAt, v.active, v.visible, v.matchesFilter]);

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Rows per multi-row INSERT. 16 bound values per row keeps this far under SQLite's variable limit. */
const WRITE_CHUNK = 250;

/**
 * Upserts listings and recomputes matches_filter. Exposed for tests and for the "re-run filter" API.
 *
 * The feed is ~16k rows and changes little between runs, so this diffs against the stored rows and writes only
 * new or changed listings, in a single transaction. One statement per row in autocommit mode meant ~32k fsyncs a run,
 * which took 10-17 minutes on a small VPS disk and starved everything else on the box.
 */
export async function upsertListings(
  ctx: AppContext,
  sourceId: string,
  listings: SimplifyListing[],
): Promise<{ upserted: number; created: number; matched: number; changed: number }> {
  const filter = compileFilter(await getSettingParsed(ctx, 'jobs.filter', jobsFilterSchema));
  if (filter.errors.length) ctx.log.warn({ errors: filter.errors }, 'jobs filter has invalid regexes; those rules are ignored');
  const now = nowIso();

  const existing = new Map<string, string>();
  for (const r of await ctx.db
    .select({
      id: jobs.id,
      company: jobs.company,
      title: jobs.title,
      locations: jobs.locations,
      url: jobs.url,
      terms: jobs.terms,
      sponsorship: jobs.sponsorship,
      degrees: jobs.degrees,
      category: jobs.category,
      postedAt: jobs.postedAt,
      active: jobs.active,
      visible: jobs.visible,
      matchesFilter: jobs.matchesFilter,
    })
    .from(jobs)
    .where(eq(jobs.source, sourceId))) {
    existing.set(r.id, fingerprint(r));
  }
  const withState = new Set((await ctx.db.select({ jobId: jobState.jobId }).from(jobState)).map((r) => r.jobId));

  const toWrite: ListingValues[] = [];
  const newStates: string[] = [];
  const seen = new Set<string>();
  let matched = 0;
  for (const l of listings) {
    if (!l?.id || !l.title || !l.company_name || !httpUrl(l.url)) continue;
    const id = `${sourceId}:${l.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const matches = filter.matches({
      title: l.title,
      locations: l.locations ?? [],
      active: !!l.active,
      isVisible: l.is_visible !== false,
      sponsorship: l.sponsorship ?? null,
      category: l.category ?? null,
      terms: l.terms ?? [],
    });
    if (matches) matched++;
    const values: ListingValues = {
      id,
      source: sourceId,
      externalId: l.id,
      company: l.company_name,
      title: l.title,
      locations: l.locations ?? [],
      url: l.url,
      terms: l.terms ?? [],
      sponsorship: l.sponsorship ?? null,
      degrees: l.degrees ?? [],
      category: l.category ?? null,
      postedAt: epochToIso(l.date_posted),
      active: !!l.active,
      visible: l.is_visible !== false,
      matchesFilter: matches,
    };
    if (existing.get(id) !== fingerprint(values)) toWrite.push(values);
    if (!withState.has(id)) newStates.push(id);
  }

  if (toWrite.length || newStates.length) {
    await ctx.db.transaction(async (tx) => {
      for (const chunk of chunks(toWrite, WRITE_CHUNK)) {
        await tx
          .insert(jobs)
          .values(chunk.map((v) => ({ ...v, score: null, updatedAt: now })))
          .onConflictDoUpdate({
            target: jobs.id,
            set: {
              company: sql`excluded.company`,
              title: sql`excluded.title`,
              locations: sql`excluded.locations`,
              url: sql`excluded.url`,
              terms: sql`excluded.terms`,
              sponsorship: sql`excluded.sponsorship`,
              degrees: sql`excluded.degrees`,
              category: sql`excluded.category`,
              postedAt: sql`excluded.posted_at`,
              active: sql`excluded.active`,
              visible: sql`excluded.visible`,
              matchesFilter: sql`excluded.matches_filter`,
              updatedAt: now,
            },
          });
      }
      for (const chunk of chunks(newStates, WRITE_CHUNK * 4)) {
        await tx
          .insert(jobState)
          .values(chunk.map((jobId) => ({ jobId })))
          .onConflictDoNothing();
      }
    });
  }
  return { upserted: seen.size, created: newStates.length, matched, changed: toWrite.length };
}

/** Re-evaluates matches_filter for every stored job (after the user edits the filter). */
export async function recomputeMatches(ctx: AppContext): Promise<{ total: number; matched: number }> {
  const filter = compileFilter(await getSettingParsed(ctx, 'jobs.filter', jobsFilterSchema));
  const rows = await ctx.db.select().from(jobs).where(ne(jobs.source, 'manual'));
  let matched = 0;
  const flip: { id: string; m: boolean }[] = [];
  for (const r of rows) {
    const m = filter.matches({
      title: r.title,
      locations: r.locations,
      active: r.active,
      isVisible: r.visible,
      sponsorship: r.sponsorship,
      category: r.category,
      terms: r.terms,
    });
    if (m) matched++;
    if (m !== r.matchesFilter) flip.push({ id: r.id, m });
  }
  if (flip.length) {
    await ctx.db.transaction(async (tx) => {
      for (const { id, m } of flip) await tx.update(jobs).set({ matchesFilter: m }).where(eq(jobs.id, id));
    });
  }
  return { total: rows.length, matched };
}

export const jobsIngester: Ingester = {
  id: 'jobs',
  intervalMinutes: 60,
  timeoutMs: 180_000,
  async run(ctx, signal) {
    const row = await getSourceRow(ctx, 'jobs');
    const configured = (row.meta as { sources?: JobsSource[] }).sources;
    const sourcesList = configured?.length ? configured : DEFAULT_JOB_SOURCES;
    if (!sourcesList.length) throw new NotConfiguredError('no job sources configured');
    const counts: Record<string, number> = {};
    for (const s of sourcesList) {
      const listings = await fetchListings(s.url, signal);
      const r = await upsertListings(ctx, s.id, listings);
      counts[`${s.id}_listings`] = r.upserted;
      counts[`${s.id}_new`] = r.created;
      counts[`${s.id}_matched`] = r.matched;
      counts[`${s.id}_changed`] = r.changed;
    }
    const [{ n }] = (await ctx.db.select({ n: sql<number>`count(*)` }).from(jobs)) as [{ n: number }];
    counts.total = n;
    return { counts, meta: { sources: sourcesList } };
  },
};
