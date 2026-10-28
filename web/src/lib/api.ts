export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOverride = (path: string, init: RequestInit & { json?: unknown }) => Promise<unknown>;
let override: ApiOverride | null = null;

/**
 * The live demo answers requests in the browser while it is mounted. An override returns undefined to let a request
 * through to the server (the demo does that for /auth). Null restores the network for everything.
 */
export function setApiOverride(fn: ApiOverride | null): void {
  override = fn;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if (override) {
    const answered = await override(path, init);
    if (answered !== undefined) return answered as T;
  }
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    if (data && typeof data === 'object' && 'error' in data) msg = String((data as { error: unknown }).error);
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
