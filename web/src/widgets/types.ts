import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Course, SourceId, WidgetInstance } from '@collected/shared';
import type { WidgetSize } from '@/dashboard/useWidgetSize';

export interface TitleContext {
  courses: Course[];
}

export interface WidgetPreset {
  label: string;
  w: number;
  h: number;
}

export interface WidgetProps<C = Record<string, unknown>> {
  instance: WidgetInstance & { config: C };
  size: WidgetSize;
  editMode: boolean;
}

/** Tint of the widget surface. `course` uses the configured course's color. */
export type WidgetAccent = 'indigo' | 'coral' | 'teal' | 'lime' | 'amber' | 'course';

export interface WidgetDef<C = Record<string, unknown>> {
  type: string;
  name: string;
  description: string;
  icon: LucideIcon;
  accent?: WidgetAccent;
  /** Sources that must be connected for the widget to be useful. Otherwise a placeholder renders. */
  requires: SourceId[];
  presets: WidgetPreset[];
  min: { w: number; h: number };
  max?: { w: number; h: number };
  /** One instance per course, etc. */
  multiInstance?: boolean;
  /** Title shown in the frame; can depend on config and loaded courses (e.g. course code). */
  title?: (instance: WidgetInstance & { config: C }, ctx: TitleContext) => string;
  Component: ComponentType<WidgetProps<C>>;
  /** Milestone marker for stubs; hides "coming soon" once implemented. */
  comingSoon?: string;
}
