/*
 * What a command needs from collected's API: a GET and a write. The CLI's `Api` speaks HTTP to a server, its
 * `LocalApi` runs the app in-process, and the server's own MCP endpoint answers through the running app with the
 * caller's bearer token, so one command module serves all three.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's JSON body when it sent one: a 409 on `POST /api/jobs` carries the existing job in it. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CommandApi {
  /** Any GET on collected's API. */
  get<T>(p: string): Promise<T>;
  /** Any write on collected's API with a JSON body. */
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, body?: unknown): Promise<T>;
}

/**
 * Reads an API answer the way every command expects: a redirect is an Access login wall, a non-2xx is an error with
 * the server's message, anything else is JSON.
 */
export async function readJson<T>(p: string, res: Response): Promise<T> {
  if (res.status >= 300 && res.status < 400) {
    throw new ApiError(`${p} redirected to ${res.headers.get('location') ?? '?'}: Cloudflare Access did not accept the credentials (service token missing or wrong)`, res.status);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    let body: unknown;
    try {
      body = JSON.parse(text);
      msg = (body as { error?: string }).error ?? msg;
    } catch {
      /* keep text */
    }
    const hint = res.status === 401 ? ' (not signed in: run `collected login`, or `collected auth helper-key` for a local server)' : '';
    throw new ApiError(`${p}: ${res.status} ${msg}${hint}`, res.status, body);
  }
  return JSON.parse(text) as T;
}
