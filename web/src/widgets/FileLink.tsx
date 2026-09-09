import type { MouseEvent, ReactNode } from 'react';
import { canvasFileUrl, previewKind, type PreviewFile } from '@/lib/canvas';
import { usePane } from '@/panes/PaneContext';

/**
 * A link to a Canvas file. Plain click previews PDFs and images in place; middle-click, cmd-click, or any other
 * type goes to a new tab through the inline-open route. Always a real href so "open in new tab" just works.
 */
export function FileLink({ file, className, title, children }: { file: PreviewFile; className?: string; title?: string; children: ReactNode }) {
  const { openPreview } = usePane();
  const kind = previewKind(file.title, file.contentType);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!kind || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openPreview(file);
  };
  return (
    <a href={canvasFileUrl(file.fileId)} target="_blank" rel="noreferrer" className={className} title={title ?? (kind ? 'Preview here; cmd-click for a new tab' : 'Open in a new tab')} onClick={onClick} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}
