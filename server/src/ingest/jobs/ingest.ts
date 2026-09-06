import { eq, sql } from 'drizzle-orm';
import { jobsFilterSchema, type JobsSource } from '@collected/shared';
import type { AppContext } from '../../context.js';
import { jobState, jobs } from '../../db/schema.js';
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

export async function fetchListings(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<SimplifyListing[]> {
  const res = await fetchImpl(url, { signal, headers: { 'User-Agent': 'collected/0.1 (+personal dashboard)' } });
  if (!res.ok) throw new Error(`listings fetch ${res.status} for ${url}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error(`listings at ${url} is not an array`);
  return data as SimplifyListing[];
}

/** Upserts listings and recomputes matches_filter. Exposed for tests and for the "re-run filter" API. */
export async function upsertListings(
  ctx: AppContext,
  sourceId: string,
  listings: SimplifyListing[],
): Promise<{ upserted: number; created: number; matched: number }> {
  const filter = compileFilter(await getSettingParsed(ctx, 'jobs.filter', jobsFilterSchema));
  if (filter.errors.length) ctx.log.warn({ errors: filter.errors }, 'jobs filter has invalid regexes; those rules are ignored');
  const now = nowIso();
  let created = 0;
  let matched = 0;
  for (const l of listings) {
    if (!l?.id || !l.title || !l.company_name || !l.url) continue;
    const id = `${sourceId}:${l.id}`;
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
    const values = {
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
      updatedAt: now,
    };
    await ctx.db
      .insert(jobs)
      .values({ ...values, score: null })
      .onConflictDoUpdate({
        target: jobs.id,
        set: {
          company: values.company,
          title: values.title,
          locations: values.locations,
          url: values.url,
          terms: values.terms,
          sponsorship: values.sponsorship,
          degrees: values.degrees,
          category: values.category,
          postedAt: values.postedAt,
          active: values.active,
          visible: values.visible,
          matchesFilter: values.matchesFilter,
          updatedAt: now,
        },
      });
    const inserted = await ctx.db.insert(jobState).values({ jobId: id }).onConflictDoNothing().returning({ jobId: jobState.jobId });
    if (inserted.length) created++;
  }
  return { upserted: listings.length, created, matched };
}

/** Re-evaluates matches_filter for every stored job (after the user edits the filter). */
export async function recomputeMatches(ctx: AppContext): Promise<{ total: number; matched: number }> {
  const filter = compileFilter(await getSettingParsed(ctx, 'jobs.filter', jobsFilterSchema));
  const rows = await ctx.db.select().from(jobs);
  let matched = 0;
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
    if (m !== r.matchesFilter) await ctx.db.update(jobs).set({ matchesFilter: m }).where(eq(jobs.id, r.id));
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
    }
    const [{ n }] = (await ctx.db.select({ n: sql<number>`count(*)` }).from(jobs)) as [{ n: number }];
    counts.total = n;
    return { counts, meta: { sources: sourcesList } };
  },
};
