import type { JobsFilter } from '@collected/shared';

export interface FilterableJob {
  title: string;
  locations: string[];
  active: boolean;
  isVisible: boolean;
  sponsorship: string | null;
  category: string | null;
  terms: string[];
}

export interface CompiledFilter {
  matches(job: FilterableJob): boolean;
  /** Which rule rejected the job, for the settings page's explainer. */
  explain(job: FilterableJob): string | null;
  errors: string[];
}

function compileRegex(src: string, errors: string[], label: string): RegExp | null {
  const s = src.trim();
  if (!s) return null;
  try {
    return new RegExp(s, 'i');
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return null;
  }
}

export function compileFilter(f: JobsFilter): CompiledFilter {
  const errors: string[] = [];
  const titleInc = compileRegex(f.title_include, errors, 'title_include');
  const titleExc = compileRegex(f.title_exclude, errors, 'title_exclude');
  const locInc = compileRegex(f.locations_include, errors, 'locations_include');
  const locExc = compileRegex(f.locations_exclude, errors, 'locations_exclude');
  const cats = new Set(f.categories_include.map((c) => c.toLowerCase()));
  const terms = new Set(f.terms_include.map((t) => t.toLowerCase()));

  const explain = (job: FilterableJob): string | null => {
    if (f.require_active && !job.active) return 'inactive';
    if (f.require_visible && !job.isVisible) return 'hidden by source';
    if (cats.size && !(job.category && cats.has(job.category.toLowerCase()))) return `category ${job.category ?? 'none'}`;
    if (terms.size && !job.terms.some((t) => terms.has(t.toLowerCase()))) return `terms ${job.terms.join(', ') || 'none'}`;
    if (titleInc && !titleInc.test(job.title)) return 'title not included';
    if (titleExc && titleExc.test(job.title)) return 'title excluded';
    if (locInc && !job.locations.some((l) => locInc.test(l))) return 'location not included';
    if (locExc && job.locations.length && job.locations.every((l) => locExc.test(l))) return 'location excluded';
    if (f.sponsorship === 'require_none_needed' && job.sponsorship && /does not offer|citizenship/i.test(job.sponsorship)) {
      // "Does Not Offer Sponsorship" / "U.S. Citizenship is Required" are fine for a citizen; only used if someone flips this on.
      return null;
    }
    return null;
  };

  return { matches: (job) => explain(job) === null, explain, errors };
}
