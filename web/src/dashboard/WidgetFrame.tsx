import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EyeOff, GripVertical } from 'lucide-react';
import type { Source, WidgetInstance } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { safeColor } from '@/lib/color';
import { cn } from '@/lib/utils';
import { useCourses } from '@/lib/queries';
import { ConnectPlaceholder } from '@/widgets/Placeholder';
import { getWidgetDef, widgetTitle } from '@/widgets/registry';
import { useWidgetSize } from './useWidgetSize';
import { WidgetHeaderSlot } from './WidgetHeader';

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
 * The chrome around every widget: a card with the title inside it (no bar behind), the widget's own controls via
 * WidgetHeader on the right, edit-mode grip and hide, and a body whose size drives the widget's tier. A course
 * widget carries its course colour as a dot by the title and as --course for the body. The body is a CSS container
 * so widget styles can use @container queries.
 */
export const WidgetFrame = forwardRef<HTMLDivElement, Props>(function WidgetFrame(
  { instance, sources, editMode, onHide, style, className, onMouseDown, onMouseUp, onTouchEnd, children },
  ref,
) {
  const def = getWidgetDef(instance.type);
  const [bodyRef, size] = useWidgetSize();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const coursesQ = useCourses();
  const title = widgetTitle(instance, { courses: coursesQ.data ?? [] });
  const missing = def?.requires.filter((id) => {
    const s = sources.find((x) => x.id === id);
    return !s || s.status === 'disconnected' || s.status === 'needs_auth';
  }) ?? [];
  const courseColor = def?.accent === 'course' ? safeColor(coursesQ.data?.find((c) => c.id === (instance.config as { courseId?: string }).courseId)?.color) : null;

  return (
    <div
      ref={ref}
      style={{ ...style, ...(courseColor ? { '--course': courseColor } : {}) } as CSSProperties}
      className={cn(
        'surface group flex flex-col overflow-hidden text-card-foreground transition-shadow duration-200',
        editMode && 'shadow-[var(--shadow-card),inset_0_0_0_1.5px_color-mix(in_srgb,var(--brand)_40%,transparent)]',
        className,
      )}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      <div className={cn('surface-head flex min-h-[50px] shrink-0 items-center gap-2.5 pl-4 pr-3 pt-1.5', editMode && 'widget-drag-handle cursor-grab select-none active:cursor-grabbing')} title={editMode ? 'Drag to move' : undefined}>
        {editMode && <GripVertical className="-ml-1 size-3.5 shrink-0 text-ter" />}
        {courseColor && <span className="size-2 shrink-0 rounded-full" style={{ background: courseColor }} />}
        <h3 className="min-w-0 shrink-0 truncate text-[16px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h3>
        <div ref={setSlot} className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-1.5" />
        {editMode && (
          <Button size="icon-xs" variant="ghost" aria-label="Hide widget" title="Hide this widget (bring it back from Add widget)" onMouseDown={(e) => e.stopPropagation()} onClick={onHide}>
            <EyeOff className="size-3.5" />
          </Button>
        )}
      </div>
      <div ref={bodyRef} className="widget-body min-h-0 flex-1" style={{ containerType: 'size' }}>
        <WidgetHeaderSlot.Provider value={slot}>
          {!def ? (
            <div className="p-3 text-sm text-sub">Unknown widget type "{instance.type}".</div>
          ) : missing.length ? (
            <ConnectPlaceholder missing={missing} sources={sources} size={size} />
          ) : (
            <def.Component instance={instance} size={size} editMode={editMode} />
          )}
        </WidgetHeaderSlot.Provider>
      </div>
      {children}
    </div>
  );
});
