import { SOURCE_IDS, scopeGrants, scopeGrantsAny, TOKEN_AREAS, type SourceId, type TokenAccess, type TokenArea, type TokenScopes } from '@collected/shared';

/** Methods that change state; everything else is a read. index.ts shares this set. */
export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/*
 * Which scope a route needs (shared/src/tokens.ts). Runs after `identityAllows`, so everything a token may never do
 * (credentials, settings, layout, tokens, import/export) is already gone; this only narrows a scoped token to its
 * areas. A token with `null` scopes passes everything here.
 *
 * Reads need `read`, mutating methods need `write`, with one preview exception (`?dryRun=1` on a push is a read).
 * A route no area claims is closed to a scoped token: a new route is private to full tokens until it is placed here.
 */

/** One source's area: which scope sees its rows and may resync it. `manual` rows are the person's own dates and notes. */
export function sourceArea(source: string): TokenArea | null {
  switch (source) {
    case 'canvas':
    case 'canvas_ical':
    case 'gradescope':
    case 'manual':
      return 'courses';
    case 'gcal':
    case 'gcal_ical':
      return 'calendar';
    case 'todoist':
    case 'gtasks':
      return 'tasks';
    case 'jobs':
      return 'jobs';
    default:
      return null;
  }
}

/** The sources a scoped token may see in `/api/items`; `null` when unrestricted. */
export function allowedSources(scopes: TokenScopes | null | undefined): SourceId[] | null {
  if (!scopes) return null;
  return SOURCE_IDS.filter((s) => {
    const a = sourceArea(s);
    return !!a && scopeGrants(scopes, a, 'read');
  });
}

type Need =
  | { kind: 'open' } // anyone with a valid token: health, who am I, versions
  | { kind: 'any' } // read on at least one area: cross-cutting status
  | { kind: 'every' } // write on every area: "sync everything"
  | { kind: 'area'; area: TokenArea }
  | { kind: 'closed' };

/** Which scope a route lives under. `path` carries no query. */
export function routeNeed(method: string, path: string): Need {
  const p = path.replace(/\/+$/, '');
  const seg = p.split('/').filter(Boolean); // ['api', 'items', ...]
  if (seg[0] !== 'api') return { kind: 'closed' };
  const [, head, a, b] = seg;
  switch (head) {
    case 'health':
    case 'auth':
    case 'system':
      return { kind: 'open' };
    case 'sources': {
      if (!a) return { kind: 'any' }; // GET /api/sources
      if (a === 'sync' && !b) return { kind: 'every' }; // POST /api/sources/sync
      if (!b || b === 'summary') return { kind: 'any' }; // GET /api/sources/:id, /summary
      const area = sourceArea(a); // :id/sync, :id/config, :id/enabled, :id/meta, canvas/cookie
      return area ? { kind: 'area', area } : { kind: 'closed' };
    }
    case 'courses':
    case 'onboarding':
    case 'canvas':
    case 'grades':
    case 'file-sync':
      return { kind: 'area', area: 'courses' };
    case 'items': {
      // Agenda rows span every source; a scoped token gets them narrowed to its areas (itemsRoutes), and may write
      // only the manual ones (overrides, manual dates, links), which are coursework.
      if (method === 'GET' || method === 'HEAD') return { kind: 'any' };
      return { kind: 'area', area: 'courses' };
    }
    case 'jobs':
      return { kind: 'area', area: 'jobs' };
    case 'calendar':
      return { kind: 'area', area: 'calendar' };
    case 'todoist':
    case 'gtasks':
    case 'todo':
      return { kind: 'area', area: 'tasks' };
    default:
      return { kind: 'closed' };
  }
}

/** `read` for a read, `write` for a mutating method; a push preview (`dryRun=1`) is a read. */
export function accessFor(method: string, path: string, query: URLSearchParams): TokenAccess {
  if (!MUTATING.has(method)) return 'read';
  if (/^\/api\/(todoist|gtasks)\/push$/.test(path.replace(/\/+$/, '')) && query.get('dryRun') === '1') return 'read';
  return 'write';
}

/**
 * Why `scopes` do not cover this request, or null when they do. The text is the 403 body, written for the person
 * reading a CLI error: it names the area and the access the token would need.
 */
export function scopeDenial(scopes: TokenScopes | null | undefined, method: string, pathWithQuery: string): string | null {
  if (!scopes) return null;
  const q = pathWithQuery.indexOf('?');
  const path = q === -1 ? pathWithQuery : pathWithQuery.slice(0, q);
  const query = new URLSearchParams(q === -1 ? '' : pathWithQuery.slice(q + 1));
  const access = accessFor(method, path, query);
  const need = routeNeed(method, path);
  switch (need.kind) {
    case 'open':
      return null;
    case 'any':
      if (access === 'read' ? scopeGrantsAny(scopes) : TOKEN_AREAS.some((a) => scopeGrants(scopes, a, 'write'))) return null;
      return `this token has no ${access} access to anything`;
    case 'every': {
      const missing = TOKEN_AREAS.filter((a) => !scopeGrants(scopes, a, 'write'));
      return missing.length ? `this token cannot sync everything: no write access to ${missing.join(', ')} (sync one source instead)` : null;
    }
    case 'area':
      return scopeGrants(scopes, need.area, access) ? null : `this token has no ${access} access to ${need.area}`;
    case 'closed':
      return 'this token is scoped and that route is not in any of its areas';
  }
}
