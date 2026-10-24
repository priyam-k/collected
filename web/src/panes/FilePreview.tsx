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

/**
 * PDFs and images straight from Canvas's CDN, framed in a dialog. The open route mints a fresh one-shot link per
 * load, the CDN serves byte ranges, so Chrome's own viewer streams the file; nothing passes through the server.
 */
export function FilePreview({ file, onClose }: { file: PreviewFile | null; onClose(): void }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [file?.fileId]);
  const kind = file ? previewKind(file.title, file.contentType) : null;
  const src = file ? canvasFileUrl(file.fileId) : '';
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] w-[min(96vw,1200px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" showCloseButton={false}>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">{file?.title}</DialogTitle>
            <DialogDescription className="text-xs">{[kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Image' : 'File', fmtSize(file?.size)].filter(Boolean).join(' · ')}</DialogDescription>
          </div>
          {file && (
            <>
              <Button asChild size="sm" variant="secondary">
                <a href={src} target="_blank" rel="noreferrer" title="Open in a new tab">
                  <ExternalLink className="size-3.5" /> Open
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href={canvasFileUrl(file.fileId, { download: true })} title="Download">
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="relative min-h-0 flex-1 bg-muted/30">
          {file && !loaded && kind && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading from Canvas…
            </div>
          )}
          {file && kind === 'pdf' && (
            <iframe key={file.fileId} title={file.title} src={src} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer" className={cn('h-full w-full border-0', !loaded && 'opacity-0')} onLoad={() => setLoaded(true)} />
          )}
          {file && kind === 'image' && (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img src={src} alt={file.title} referrerPolicy="no-referrer" className={cn('max-h-full max-w-full object-contain', !loaded && 'opacity-0')} onLoad={() => setLoaded(true)} />
            </div>
          )}
          {file && !kind && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>No inline preview for this type.</p>
              <Button asChild size="sm" variant="secondary">
                <a href={src} target="_blank" rel="noreferrer">Open in a new tab</a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
