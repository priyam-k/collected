import { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { canvasFileUrl, previewKind, type PreviewFile } from '@/lib/canvas';
import { cn } from '@/lib/utils';

const fmtSize = (n: number | null | undefined): string => {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/** An iframe never reports a failed load, so after this long without one the fallback link shows under the spinner. */
const SLOW_MS = 15_000;

/**
 * PDFs and images straight from Canvas's CDN, framed in a dialog. The open route mints a fresh one-shot link per
 * load, the CDN serves byte ranges, so Chrome's own viewer streams the file; nothing passes through the server.
 */
export function FilePreview({ file, onClose }: { file: PreviewFile | null; onClose(): void }) {
  const [state, setState] = useState<'loading' | 'slow' | 'loaded' | 'failed'>('loading');
  useEffect(() => {
    setState('loading');
    if (!file) return;
    const t = window.setTimeout(() => setState((s) => (s === 'loading' ? 'slow' : s)), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [file?.fileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = state === 'loaded';
  const kind = file ? previewKind(file.title, file.contentType) : null;
  const src = file ? canvasFileUrl(file.fileId) : '';
  const openInTab = (
    <Button asChild size="sm" variant="secondary">
      <a href={src} target="_blank" rel="noreferrer">
        <ExternalLink className="size-3.5" /> Open in a new tab
      </a>
    </Button>
  );
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] w-[min(96vw,1200px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" showCloseButton={false}>
        <div className="flex shrink-0 items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">{file?.title}</DialogTitle>
            <DialogDescription className="text-xs">{[kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Image' : 'File', fmtSize(file?.size)].filter(Boolean).join(' · ')}</DialogDescription>
          </div>
          {file && (
            <>
              <Button asChild size="sm" variant="secondary">
                <a href={src} target="_blank" rel="noreferrer" title="Open in a new tab">
                  <ExternalLink className="size-3.5" /> <span className="hidden sm:inline">Open</span>
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href={canvasFileUrl(file.fileId, { download: true })} title="Download">
                  <Download className="size-3.5" /> <span className="hidden sm:inline">Download</span>
                </a>
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="relative min-h-0 flex-1 bg-well/60">
          {file && kind && (state === 'loading' || state === 'slow') && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading from Canvas…
              </span>
              {state === 'slow' && (
                <span className="pointer-events-auto flex flex-col items-center gap-2 text-xs">
                  Taking a while. Canvas may have refused the preview.
                  {openInTab}
                </span>
              )}
            </div>
          )}
          {file && state === 'failed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>Canvas did not send a preview for this file.</p>
              {openInTab}
            </div>
          )}
          {file && kind === 'pdf' && (
            <iframe key={file.fileId} title={file.title} src={src} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer" className={cn('h-full w-full border-0', !loaded && 'opacity-0')} onLoad={() => setState('loaded')} onError={() => setState('failed')} />
          )}
          {file && kind === 'image' && state !== 'failed' && (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img key={file.fileId} src={src} alt={file.title} referrerPolicy="no-referrer" className={cn('max-h-full max-w-full object-contain', !loaded && 'opacity-0')} onLoad={() => setState('loaded')} onError={() => setState('failed')} />
            </div>
          )}
          {file && !kind && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>No inline preview for this type.</p>
              {openInTab}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
