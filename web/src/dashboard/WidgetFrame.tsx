import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { EyeOff, GripVertical } from 'lucide-react';
import type { Source, WidgetInstance } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCourses } from '@/lib/queries';
import { ConnectPlaceholder } from '@/widgets/Placeholder';
import { getWidgetDef, widgetTitle } from '@/widgets/registry';
import { useWidgetSize } from './useWidgetSize';

interface Props {
  instance: WidgetInstance;
  sources: Source[];
  editMode: boolean;
  onHide(): void;
  // react-grid-layout injects these into its direct children
  style?: CSSProperties;
  className?: string;
  onMouseDown?: React.MouseEventHandler;
  onMouseUp?: React.MouseEventHandler;
  onTouchEnd?: React.TouchEventHandler;
  children?: ReactNode;
}

/**
 * The chrome around every widget: title bar (drag handle + hide in edit mode) and a body whose size drives
 * the widget's tier. The body is a CSS container so widget styles can use @container queries.
 */
export const WidgetFrame = forwardRef<HTMLDivElement, Props>(function WidgetFrame(
  { instance, sources, editMode, onHide, style, className, onMouseDown, onMouseUp, onTouchEnd, children },
  ref,
) {
  const def = getWidgetDef(instance.type);
  const [bodyRef, size] = useWidgetSize();
  const coursesQ = useCourses();
  const title = widgetTitle(instance, { courses: coursesQ.data ?? [] });
  const Icon = def?.icon;
  const missing = def?.requires.filter((id) => {
    const s = sources.find((x) => x.id === id);
    return !s || s.status === 'disconnected' || s.status === 'needs_auth';
  }) ?? [];

  return (
    <div
      ref={ref}
      style={style}
      className={cn('group flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs', editMode && 'ring-1 ring-ring/40', className)}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      <div className={cn('flex h-8 shrink-0 items-center gap-1.5 border-b px-2 text-xs font-medium', editMode && 'widget-drag-handle cursor-grab select-none active:cursor-grabbing')}>
        {editMode && <GripVertical className="size-3.5 text-muted-foreground" />}
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <span className="truncate">{title}</span>
        <span className="ml-auto flex items-center gap-1">
          {editMode && (
            <Button size="icon-xs" variant="ghost" aria-label="Hide widget" onMouseDown={(e) => e.stopPropagation()} onClick={onHide}>
              <EyeOff className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
      <div ref={bodyRef} className="widget-body min-h-0 flex-1" style={{ containerType: 'size' }}>
        {!def ? (
          <div className="p-3 text-sm text-muted-foreground">Unknown widget type "{instance.type}".</div>
        ) : missing.length ? (
          <ConnectPlaceholder missing={missing} sources={sources} size={size} />
        ) : (
          <def.Component instance={instance} size={size} editMode={editMode} />
        )}
      </div>
      {children}
    </div>
  );
});
