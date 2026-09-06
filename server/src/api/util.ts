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

export const csv = (v: string | undefined): string[] | undefined =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
