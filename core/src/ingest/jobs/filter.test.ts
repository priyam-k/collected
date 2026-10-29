import { describe, expect, it } from 'vitest';
import { jobsFilterSchema } from '@collected/shared';
import { compileFilter } from './filter.js';
import sample from './fixtures/listings.sample.json' with { type: 'json' };
import seed from '../../../../artifacts/seed-config.json' with { type: 'json' };

const seedFilter = jobsFilterSchema.parse(seed.jobs.filter);

const job = (over: Partial<Parameters<ReturnType<typeof compileFilter>['matches']>[0]> = {}) => ({
  title: 'Software Engineer Intern',
  locations: ['College Park, MD'],
  active: true,
  isVisible: true,
  sponsorship: 'Other',
  category: 'Software',
  terms: ['Summer 2027'],
  ...over,
});

describe('jobs filter (seed config)', () => {
  const f = compileFilter(seedFilter);

  it('compiles without regex errors', () => {
    expect(f.errors).toEqual([]);
  });

  it('accepts a US SWE internship', () => {
    expect(f.explain(job())).toBeNull();
  });

  it('rejects hardware, business, and non-US roles', () => {
    expect(f.explain(job({ title: 'Hardware Engineer Intern' }))).toBe('title excluded');
    expect(f.explain(job({ title: 'Marketing Intern', category: 'Product' }))).toMatch(/category/);
    expect(f.explain(job({ locations: ['Toronto, ON, Canada'] }))).toBe('location not included');
    expect(f.explain(job({ locations: ['Remote in USA'] }))).toBeNull();
  });

  it('rejects inactive and wrong-term listings', () => {
    expect(f.explain(job({ active: false }))).toBe('inactive');
    expect(f.explain(job({ terms: ['Summer 2026'] }))).toMatch(/terms/);
  });

  it('robotics and ML titles pass', () => {
    expect(f.explain(job({ title: 'Robotics Software Intern' }))).toBeNull();
    expect(f.explain(job({ title: 'Machine Learning Intern', category: 'AI/ML/Data' }))).toBeNull();
  });

  it('runs over the real fixture without throwing and matches a sane subset', () => {
    const results = (sample as Array<Record<string, unknown>>).map((l) =>
      f.matches({
        title: String(l.title),
        locations: (l.locations as string[]) ?? [],
        active: !!l.active,
        isVisible: l.is_visible !== false,
        sponsorship: (l.sponsorship as string) ?? null,
        category: (l.category as string) ?? null,
        terms: (l.terms as string[]) ?? [],
      }),
    );
    expect(results.length).toBe(sample.length);
    expect(results.filter(Boolean).length).toBeLessThan(sample.length);
  });

  it('surfaces regex errors instead of throwing', () => {
    const bad = compileFilter({ ...seedFilter, title_include: '(' });
    expect(bad.errors[0]).toMatch(/title_include/);
    expect(bad.matches(job())).toBe(true); // broken rule is ignored
  });
});
