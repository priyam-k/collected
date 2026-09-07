/**
 * Canvas file links. The stored URL (`/files/:id/download?download_frd=1`) always downloads; the server route
 * mints a one-shot inline link so PDFs open in the browser tab instead.
 */
export function canvasFileUrl(fileId: string | number, opts: { download?: boolean } = {}): string {
  return `/api/canvas/files/${fileId}/open${opts.download ? '?download=1' : ''}`;
}

/** File id from any Canvas file URL, e.g. https://umd.instructure.com/files/90735997/download?download_frd=1 */
export function canvasFileIdFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/files\/(\d+)(?:[/?]|$)/);
  return m?.[1] ?? null;
}

/** Origin of the Canvas instance, taken from any stored Canvas URL; falls back to UMD's. */
export function canvasOrigin(urls: (string | null | undefined)[]): string {
  for (const u of urls) {
    if (!u) continue;
    try {
      const o = new URL(u);
      if (/instructure\.com$|canvas/.test(o.hostname)) return o.origin;
    } catch {
      /* ignore */
    }
  }
  return 'https://umd.instructure.com';
}
