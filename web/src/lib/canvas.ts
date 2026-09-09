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

export type PreviewKind = 'pdf' | 'image' | null;

/** What the preview dialog can show inline. Chrome renders PDFs in an iframe; images are plain <img>. */
export function previewKind(title: string | null | undefined, contentType?: string | null): PreviewKind {
  const ct = (contentType ?? '').toLowerCase();
  const ext = (title ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return null;
}

export interface PreviewFile {
  fileId: string;
  title: string;
  contentType?: string | null;
  size?: number | null;
}
