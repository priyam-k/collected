/**
 * Canvas file links. The stored URL (`/files/:id/download?download_frd=1`) always downloads; the server route
 * mints a one-shot inline link so PDFs open in the browser tab instead.
 */
export function canvasFileUrl(fileId: string | number, opts: { download?: boolean } = {}): string {
  return `/api/canvas/files/${encodeURIComponent(String(fileId))}/open${opts.download ? '?download=1' : ''}`;
}

/** File id from any Canvas file URL, e.g. https://umd.instructure.com/files/90735997/download?download_frd=1 */
export function canvasFileIdFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/files\/(\d+)(?:[/?]|$)/);
  return m?.[1] ?? null;
}

const INSTRUCTURE_HOST = /(?:^|\.)instructure\.com$/i;
/** A self-hosted instance: the `canvas.` subdomain of a school. */
const CANVAS_HOST = /^canvas\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/**
 * Origin of the Canvas instance, taken from any stored Canvas URL; null when no URL names one. Hosts are anchored, so
 * `evil-instructure.com` or `notcanvas.example` never pass, and an instructure.com origin anywhere in the list
 * beats a `canvas.`-prefixed one (upstream URLs are instructor data; the course header links here).
 */
export function canvasOrigin(urls: (string | null | undefined)[]): string | null {
  let selfHosted: string | null = null;
  for (const u of urls) {
    if (!u) continue;
    try {
      const o = new URL(u);
      if (o.protocol !== 'https:') continue;
      if (INSTRUCTURE_HOST.test(o.hostname)) return o.origin;
      if (!selfHosted && CANVAS_HOST.test(o.hostname)) selfHosted = o.origin;
    } catch {
      /* ignore */
    }
  }
  return selfHosted;
}

export type PreviewKind = 'pdf' | 'image' | null;

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/**
 * What the preview dialog can show inline. Chrome renders PDFs in an iframe; images are plain <img>. The content
 * type Canvas reports wins; the extension only decides when there is none, so a `syllabus.pdf` that is really
 * HTML is download-only rather than a page framed inside the dashboard.
 */
export function previewKind(title: string | null | undefined, contentType?: string | null): PreviewKind {
  const ct = (contentType ?? '').trim().toLowerCase().split(';')[0]!;
  const ext = (title ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ct) {
    if (ct === 'application/pdf') return 'pdf';
    if (ct.startsWith('image/')) return 'image';
    return null;
  }
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

export interface PreviewFile {
  fileId: string;
  title: string;
  contentType?: string | null;
  size?: number | null;
}

/**
 * The Canvas address as the settings form accepts it: a bare host (`umd.instructure.com`), a URL with a path
 * (`https://umd.instructure.com/courses/1`), or `http://…`, all reduced to `https://<host>`. Null when there is no
 * host in it (empty, spaces, no dot), so the form can say why its button is off rather than let the server reject it.
 */
export function normalizeCanvasBaseUrl(input: string): string | null {
  const raw = input.trim().replace(/^https?:\/\//i, '');
  if (!raw || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(`https://${raw}`);
  } catch {
    return null;
  }
  if (u.username || u.password || !u.hostname.includes('.') || u.hostname.endsWith('.')) return null;
  return `https://${u.host}`;
}

/** Why the Sources page's cookie button is off, in the user's terms; null when it can be pressed. */
export function canvasCookieBlocker(baseUrl: string | null, cookie: string): string | null {
  if (!baseUrl) return 'Enter your Canvas address first';
  if (!cookie.trim()) return 'Paste the cookie';
  if (!cookie.includes('=')) return 'That is not a cookie yet';
  return null;
}
