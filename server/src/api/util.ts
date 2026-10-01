import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export function bad(message: string, status: 400 | 404 | 409 | 422 = 400): never {
  throw new HTTPException(status, { message, res: new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } }) });
}

/** Parses a JSON body with a zod schema, returning a 400 with issues on failure. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
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
