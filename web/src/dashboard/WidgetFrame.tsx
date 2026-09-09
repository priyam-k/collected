import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EyeOff, GripVertical } from 'lucide-react';
import type { Source, WidgetInstance } from '@collected/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCourses } from '@/lib/queries';
import { ConnectPlaceholder } from '@/widgets/Placeholder';
import { getWidgetDef, widgetTitle } from '@/widgets/registry';
import type { WidgetAccent } from '@/widgets/types';
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

const ACCENT_VAR: Record<Exclude<WidgetAccent, 'course'>, string> = {
  indigo: 'var(--indigo)',
  coral: 'var(--coral)',
  teal: 'var(--teal)',
  lime: 'var(--lime)',
  amber: 'var(--amber)',
};

/**
 * The chrome around every widget: a tinted surface, a well header (title, the widget's own controls via
 * WidgetHeader, edit-mode grip and hide), and a body whose size drives the widget's tier. The body is a CSS
 * container so widget styles can use @container queries.
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
  const accent = def?.accent ?? 'indigo';
  const courseColor = accent === 'course' ? coursesQ.data?.find((c) => c.id === (instance.config as { courseId?: string }).courseId)?.color : null;
  const accentVar = accent === 'course' ? (courseColor ?? 'var(--indigo)') : ACCENT_VAR[accent];

  return (
    <div
      ref={ref}
      style={{ ...style, '--accent': accentVar } as CSSProperties}
      className={cn('surface group flex flex-col overflow-hidden text-card-foreground', editMode && 'ring-1 ring-indigo/40', className)}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      <div className={cn('surface-head flex min-h-11 shrink-0 items-center gap-2.5 px-3.5 py-1.5', editMode && 'widget-drag-handle cursor-grab select-none active:cursor-grabbing')} title={editMode ? 'Drag to move' : undefined}>
        {editMode && <GripVertical className="size-3.5 shrink-0 text-ter" />}
        <span className="shrink-0 text-[15px] font-semibold text-sub">{title}</span>
        <div ref={setSlot} className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5" />
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
