import { Briefcase, CalendarDays, CheckSquare, GraduationCap, LayoutList, Plug } from 'lucide-react';
import type { WidgetInstance } from '@collected/shared';
import type { TitleContext } from './types';
import { CalendarWidget } from './calendar/CalendarWidget';
import { ClassWidget } from './class/ClassWidget';
import { ClassesWidget } from './classes/ClassesWidget';
import { SourcesWidget } from './sources/SourcesWidget';
import { TodoWidget } from './todo/TodoWidget';
import { makeStub } from './stubs';
import type { WidgetDef } from './types';

/**
 * Every widget the dashboard knows about. Adding a widget = adding an entry here.
 * Stubs render a "coming soon" body until their milestone lands.
 */
export const WIDGETS: WidgetDef[] = [
  {
    type: 'calendar',
    name: 'Calendar',
    description: 'Events, deadlines, and todos on one timeline.',
    icon: CalendarDays,
    requires: [],
    presets: [
      { label: 'Next up', w: 3, h: 3 },
      { label: 'Agenda', w: 4, h: 7 },
      { label: 'Week', w: 8, h: 7 },
      { label: 'Month', w: 12, h: 9 },
    ],
    min: { w: 3, h: 3 },
    Component: CalendarWidget,
  },
  {
    type: 'todo',
    name: 'To do',
    description: 'Todoist tasks by section, with homework from Canvas and Gradescope on top.',
    icon: CheckSquare,
    requires: [],
    presets: [
      { label: 'List', w: 4, h: 7 },
      { label: 'Columns', w: 8, h: 6 },
    ],
    min: { w: 3, h: 3 },
    Component: TodoWidget,
  },
  {
    type: 'classes',
    name: 'Classes overview',
    description: 'One row per course: next due, hotlinks.',
    icon: LayoutList,
    requires: [],
    presets: [
      { label: 'Compact', w: 6, h: 4 },
      { label: 'Wide', w: 12, h: 4 },
    ],
    min: { w: 4, h: 3 },
    Component: ClassesWidget,
  },
  {
    type: 'class',
    name: 'Class',
    description: 'A single course: assignments, announcements, hotlinks, TA duties.',
    icon: GraduationCap,
    requires: [],
    presets: [
      { label: 'Small', w: 3, h: 4 },
      { label: 'Medium', w: 4, h: 6 },
      { label: 'Large', w: 6, h: 8 },
    ],
    min: { w: 3, h: 3 },
    multiInstance: true,
    title: (w, ctx) => {
      const cfg = w.config as { courseCode?: string; courseId?: string };
      const c = ctx.courses.find((x) => x.id === cfg.courseId);
      return c ? `${c.code}${c.section ? ` · ${c.section}` : ''}` : (cfg.courseCode ?? 'Class');
    },
    Component: ClassWidget as WidgetDef['Component'],
  },
  {
    type: 'jobs',
    name: 'Job feed',
    description: 'New internship postings that match your filter.',
    icon: Briefcase,
    requires: ['jobs'],
    presets: [
      { label: 'Tape', w: 8, h: 3 },
      { label: 'List', w: 4, h: 8 },
    ],
    min: { w: 3, h: 2 },
    Component: makeStub('Job feed widget arrives in M7. The ingester is already running; see Settings → Jobs.'),
    comingSoon: 'M7',
  },
  {
    type: 'sources',
    name: 'Sources',
    description: 'Health of every integration: status, last sync, errors.',
    icon: Plug,
    requires: [],
    presets: [
      { label: 'Dots', w: 3, h: 2 },
      { label: 'Table', w: 6, h: 3 },
    ],
    min: { w: 2, h: 2 },
    Component: SourcesWidget,
  },
];

const byType = new Map(WIDGETS.map((w) => [w.type, w]));

export function getWidgetDef(type: string): WidgetDef | undefined {
  return byType.get(type);
}

export function widgetTitle(instance: WidgetInstance, ctx: TitleContext = { courses: [] }): string {
  const def = byType.get(instance.type);
  if (!def) return instance.type;
  return def.title ? def.title(instance, ctx) : def.name;
}
