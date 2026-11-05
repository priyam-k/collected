import { describe, expect, it } from 'vitest';
import { extractReqId, normalizeJobUrl } from '@collected/shared';
import { upsertListings, type SimplifyListing } from './ingest.js';
import { jobs } from '../../db/schema.js';
import { testContext } from '../../test-util.js';
import sample from './fixtures/listings.sample.json' with { type: 'json' };

describe('extractReqId', () => {
  it('reads the requisition id out of the URL shapes the feed carries, and nothing else', () => {
    const cases: [string, string | null][] = [
      // Workday: the suffix after the last underscore of the last segment.
      ['https://kla.wd1.myworkdayjobs.com/search/job/Milpitas-CA/Algorithm-Research-Intern_2533331-1', '2533331-1'],
      ['https://adobe.wd5.myworkdayjobs.com/external_experienced/job/London/XMLNAME-2026-Intern---Product-Manager--Adobecom-_R162234', 'R162234'],
      ['https://pinerest.wd5.myworkdayjobs.com/en-US/PineRest/job/Grand-Rapids-MI/Intern---Social-Worker_JR103945', 'JR103945'],
      ['https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Toronto-Ontario/Global-Markets-Intern_R_1465955', 'R_1465955'],
      ['https://vrtx.wd501.myworkdayjobs.com/vertex_careers/job/San-Diego-CA/Vertex-Summer-Intern-2026_REQ-27697', 'REQ-27697'],
      ['https://globalfoundries.wd1.myworkdayjobs.com/External/job/Austin/IP-Design-Engineering-Intern_JR-2504799', 'JR-2504799'],
      ['https://leidos.wd5.myworkdayjobs.com/External/job/Bethesda-MD/Computer-Engineering-Co-op_R-00173303', 'R-00173303'],
      ['https://cartech.wd5.myworkdayjobs.com/CTCExternal/job/Reading-PA/Digital-Technologies-Intern_26019', '26019'],
      // Greenhouse, iCIMS, generic /jobs/<digits>.
      ['https://job-boards.greenhouse.io/colabsoftware/jobs/5022855008', '5022855008'],
      ['https://boards.greenhouse.io/stripe/jobs/7584789003?gh_src=abc123', '7584789003'],
      ['https://careers-lmi.icims.com/jobs/13504/job?mobile=true&needsRedirect=false', '13504'],
      ['https://careers.medpace.com/jobs/12212?lang=en-us&icims=1', '12212'],
      // Oracle HCM /job/<digits>, and slugs that end in a long number.
      ['https://fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/30064', '30064'],
      ['https://www.example.com/careers/job/software-intern-123456', '123456'],
      // Query parameters that name it.
      ['https://careers.example.com/apply?jid=98765', '98765'],
      ['https://careers.example.com/posting?req_id=R-2026-0042&utm_source=simplify', 'R-2026-0042'],
      ['https://careers.example.com/posting?requisition=12345', '12345'],
      ['https://careers.example.com/posting?requisitionId=ABC-77', 'ABC-77'],
      ['https://example.com/jobs?gh_jid=4567890', '4567890'],
      // Lever and Rippling: the UUID.
      ['https://jobs.lever.co/acme/7d0f3b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b', '7d0f3b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b'],
      ['https://ats.rippling.com/tive-careers/jobs/e7ed0c47-bf2e-4105-a793-e48dc0e0f710', 'e7ed0c47-bf2e-4105-a793-e48dc0e0f710'],
      // A requisition segment, and an R-number on its own.
      ['https://careers.example.com/requisitions/2026-SWE-01', '2026-SWE-01'],
      ['https://careers.example.com/us/en/R0061930/ml-intern', 'R0061930'],
      // No match: stays null.
      ['https://jobs.smartrecruiters.com/Experian/744000102584561', null],
      ['https://www.example.com/careers/software-intern', null],
      ['https://www.example.com/jobs/2026-summer-internships', null],
      ['https://www.example.com/jobs/123', null],
      ['https://example.com/careers?utm_source=simplify', null],
      ['not a url', null],
    ];
    for (const [url, want] of cases) expect(extractReqId(url), url).toBe(want);
  });
});

describe('normalizeJobUrl', () => {
  it('collapses scheme, host case, www, tracking parameters, fragments and trailing slashes', () => {
    const key = normalizeJobUrl('https://job-boards.greenhouse.io/acme/jobs/123456');
    for (const same of [
      'http://job-boards.greenhouse.io/acme/jobs/123456',
      'HTTPS://Job-Boards.Greenhouse.io/acme/jobs/123456/',
      'https://www.job-boards.greenhouse.io/acme/jobs/123456?gh_src=xyz&utm_source=simplify#app',
      'job-boards.greenhouse.io/acme/jobs/123456',
    ])
      expect(normalizeJobUrl(same), same).toBe(key);
    expect(normalizeJobUrl('https://a.test/x?b=2&a=1')).toBe(normalizeJobUrl('https://a.test/x?a=1&b=2'));
    expect(normalizeJobUrl('https://a.test/x?a=1')).not.toBe(normalizeJobUrl('https://a.test/x?a=2'));
    expect(normalizeJobUrl('https://a.test/jobs/1')).not.toBe(normalizeJobUrl('https://a.test/jobs/2'));
    expect(normalizeJobUrl('')).toBe('');
  });
});

describe('ingester req ids', () => {
  it('stores one id per listing and drops an id two listings would share', async () => {
    const ctx = await testContext();
    const listings = (sample as SimplifyListing[]).slice(0, 6);
    const dup = listings.map((l, i) => (i < 2 ? { ...l, url: `https://boards.greenhouse.io/acme/jobs/777000${i === 0 ? '1' : '1'}` } : l));
    await upsertListings(ctx, 'simplify', dup);
    const rows = await ctx.db.select({ id: jobs.id, url: jobs.url, reqId: jobs.reqId }).from(jobs);
    const shared = rows.filter((r) => r.url.endsWith('7770001'));
    expect(shared).toHaveLength(2);
    expect(shared.every((r) => r.reqId === null)).toBe(true);
    for (const r of rows.filter((r) => !r.url.endsWith('7770001'))) expect(r.reqId, r.url).toBe(extractReqId(r.url));
    // A later run that gives one of them a fresh URL gets its id; the other keeps none because the first now owns it.
    const next = dup.map((l, i) => (i === 0 ? { ...l, url: 'https://boards.greenhouse.io/acme/jobs/7770002' } : l));
    await upsertListings(ctx, 'simplify', next);
    const after = await ctx.db.select({ url: jobs.url, reqId: jobs.reqId }).from(jobs);
    expect(after.find((r) => r.url.endsWith('7770002'))?.reqId).toBe('7770002');
    expect(after.find((r) => r.url.endsWith('7770001'))?.reqId).toBe('7770001');
  });
});
