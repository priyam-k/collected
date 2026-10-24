/** What the course colour picker produces and what Google sends for calendars: hex, nothing else. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * A colour that is safe to interpolate into an inline style: `#rgb`, `#rrggbb` or `#rrggbbaa`, otherwise
 * `undefined` so the caller's own token fallback applies. Course colours are user data and calendar colours are
 * upstream data; both are mixed into `color-mix(...)` and gradients, so an unvalidated string is CSS injection.
 */
export function safeColor(c: string | null | undefined): string | undefined {
  return c && HEX.test(c) ? c : undefined;
}
