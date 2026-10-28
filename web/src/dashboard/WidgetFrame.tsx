import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Source, WidgetInstance } from '@collected/shared';
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
 * WidgetHeader on the right, and a body whose size drives the widget's tier. Edit mode changes nothing inside the
 * card, so nothing shifts: the title row becomes the drag handle, a remove badge sits over the top-left corner the
 * way iOS does it, and the resize grip (Grid) follows the bottom-right corner. A course
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
        'surface widget-frame group relative flex flex-col text-card-foreground',
        className,
      )}
      data-editing={editMode || undefined}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      {editMode && (
        <button
          type="button"
          aria-label={`Remove ${title} from the dashboard`}
          title="Hide this widget (bring it back from Add widget)"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={onHide}
          className="absolute -left-2 -top-2 z-20 grid size-[26px] place-items-center rounded-full bg-ink-muted text-surface shadow-[0_2px_6px_rgba(0,0,0,.25)] duration-200 animate-in fade-in zoom-in-50 hover:bg-ink active:scale-90"
        >
          <X className="size-3.5" strokeWidth={3} />
        </button>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
      <div className={cn('surface-head flex min-h-[50px] shrink-0 items-center gap-2.5 pl-4 pr-3 pt-1.5', editMode && 'widget-drag-handle cursor-grab select-none active:cursor-grabbing')} title={editMode ? 'Drag to move' : undefined}>
        {courseColor && <span className="size-2 shrink-0 rounded-full" style={{ background: courseColor }} />}
        {/* One row, always: the title truncates past 60% of the row (all of it when the slot is empty), and the slot
            clips rather than wrapping into a second row that would steal height from the body (its padding, cancelled
            by margin, leaves room for focus rings). Widgets drop or shorten their controls at narrow tiers. */}
        <h3 className="min-w-0 max-w-[60%] truncate [&:has(+div:empty)]:max-w-none text-[16px] font-semibold leading-tight tracking-[-0.015em] text-ink" title={title}>{title}</h3>
        <div ref={setSlot} className="-my-1 -mr-1 flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-hidden py-1 pr-1" />
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
      </div>
      {children}
    </div>
  );
});
