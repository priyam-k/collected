import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export function bad(message: string, status: 400 | 403 | 404 | 409 | 422 = 400): never {
  throw new HTTPException(status, { message, res: new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }) });
}

/** HTML forms cannot send this content type, which is what keeps a cross-site form post out of the JSON routes. */
function requireJson(c: Context): void {
  const ct = c.req.header('content-type') ?? '';
  if (!/^application\/json\b/i.test(ct)) {
    throw new HTTPException(415, { res: new Response(JSON.stringify({ error: 'content-type must be application/json' }), { status: 415, headers: { 'content-type': 'application/json' } }) });
  }
}

/** A bounded positive integer from a query string; the default when absent, a 400 when malformed. */
export function intParam(v: string | undefined, opts: { min?: number; max: number; def: number }): number {
  if (v === undefined || v === '') return opts.def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < (opts.min ?? 1) || n > opts.max) bad(`limit must be an integer between ${opts.min ?? 1} and ${opts.max}`);
  return n;
}

/** Parses a JSON body with a zod schema, returning a 400 with issues on failure. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  requireJson(c);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    bad('invalid JSON body');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const message = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    bad(message, 422);
  }
  return r.data;
}

/**
 * Parses a partial update and returns only the fields the client actually sent.
 *
 * zod 4 applies `.default()` even under `.partial()`: parsing `{ notes: "x" }` against a schema whose `schedule`
 * defaults to `{}` yields `{ notes: "x", schedule: {} }`, and writing that back resets every omitted field. That is
 * how a config-only course update emptied five courses' schedules and links (DECISIONS 041). Never spread or
 * `.set()` the result of `schema.partial().parse()`; use this.
 */
export async function parsePatch<S extends z.ZodObject>(c: Context, schema: S): Promise<Partial<z.infer<S>>> {
  requireJson(c);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    bad('invalid JSON body');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('expected a JSON object', 422);
  const r = schema.partial().safeParse(raw);
  if (!r.success) {
    const message = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    bad(message, 422);
  }
  const sent = raw as Record<string, unknown>;
  return Object.fromEntries(Object.entries(r.data as Record<string, unknown>).filter(([k]) => Object.hasOwn(sent, k))) as Partial<z.infer<S>>;
}

export const csv = (v: string | undefined): string[] | undefined =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
