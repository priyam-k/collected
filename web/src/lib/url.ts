/**
 * An href that is safe to put in an anchor: parses as a URL and is http(s). Upstream data (Canvas, Gradescope,
 * Todoist, the job feed) and user-entered hotlinks land in `href` unvalidated otherwise; React only blocks
 * `javascript:` today, and nothing stops `data:` or a scheme handler.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
