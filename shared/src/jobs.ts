/*
 * Two pure helpers the server, the ingester and the web share for telling postings apart (DECISIONS 063):
 * a requisition id read out of a posting URL, and a URL key that ignores the parts a tracking link changes.
 */

/** Query parameters that identify a visitor or a campaign, never the posting. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gh_src|lever-source|lever-origin|source|src|ref|refid|referrer|referer|fbclid|gclid|msclkid|mc_[a-z]+|trk|trackingid|tracking_id|campaign|cid|s_cid|icid|mkt_tok|hl|lang|locale)$/i;

/**
 * A key for "the same posting": host lowercased, scheme and `www.` dropped, tracking parameters and the fragment
 * removed, the remaining parameters sorted, no trailing slash. Not a URL to open; `jobs.url` keeps the original.
 * Unparseable input is returned trimmed and lowercased, so a comparison still means something.
 */
export function normalizeJobUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return s.toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) ? `:${u.port}` : '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = u.pathname.replace(/\/+$/, '') || '';
  return `${host}${port}${path}${query}`;
}

const WORKDAY = /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The requisition id a posting URL carries, or null. Conservative on purpose: a wrong id would merge two postings,
 * a missing one only loses a dedupe hint. In order: a query parameter that names it (`jid`, `req_id`, `requisition`,
 * `gh_jid`); Workday's `_R12345` / `_JR-123456` suffix; a Lever or Rippling UUID after the company; `/jobs/<digits>`
 * (Greenhouse, iCIMS, most ATSs); `/job/<digits>` or `/job/<slug>-<digits>`; a `requisition(s)/<id>` segment; an
 * `R0123456`-style token on its own in the path. Anything else is null.
 */
export function extractReqId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const host = u.hostname.toLowerCase();

  for (const [k, v] of u.searchParams) {
    if (/^(jid|gh_jid|req[_-]?id|requisition(?:[_-]?(?:id|number|no))?|job_?req(?:_?id)?)$/i.test(k) && /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(v)) return v;
  }

  if (WORKDAY.test(host)) {
    const last = path.split('/').pop() ?? '';
    const m = /_([A-Za-z]{0,4}[-_]?\d{4,}(?:-\d{1,3})?)$/.exec(last);
    if (m) return m[1]!;
  }

  if (/(^|\.)lever\.co$/.test(host) || /(^|\.)rippling\.com$/.test(host)) {
    const uuid = path.split('/').find((seg) => UUID.test(seg));
    if (uuid) return uuid.toLowerCase();
  }

  let m = /\/jobs\/(\d{4,})(?:$|[/?#])/.exec(path);
  if (m) return m[1]!;
  m = /\/job\/(\d{4,})$/.exec(path);
  if (m) return m[1]!;
  m = /\/job\/[^/]*?[-_](\d{5,})$/.exec(path);
  if (m) return m[1]!;
  m = /\/requisitions?\/([A-Za-z0-9][A-Za-z0-9._-]{1,39})(?:$|\/)/.exec(path);
  if (m) return m[1]!;
  m = /(?:^|[/_-])(R\d{5,}|JR\d{5,}|REQ-?\d{4,})(?:$|[/_-])/.exec(path);
  if (m) return m[1]!;
  return null;
}
