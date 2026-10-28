import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  ApiToken,
  CanvasEnrollment,
  Course,
  CourseGrades,
  CourseInput,
  FileSyncDevice,
  FileSyncFileView,
  FileSyncManifestCourse,
  ManualEventInput,
  ManualJobInput,
  Me,
  EffectiveItem,
  HealthResponse,
  ItemKind,
  Job,
  JobStateValue,
  Layouts,
  Source,
  SourceId,
  SystemVersion,
  UpdateStatus,
  TodoApp,
  WidgetInstance,
  TodoAppStatus,
  TodoStatus,
  GtasksPushConfig,
} from '@collected/shared';
import { api } from './api';

export const qk = {
  health: ['health'] as const,
  me: ['me'] as const,
  tokens: ['auth', 'tokens'] as const,
  sources: ['sources'] as const,
  courses: ['courses'] as const,
  layout: ['layout'] as const,
  widgets: ['widgets'] as const,
  settings: ['settings'] as const,
  items: (params: Record<string, string | undefined>) => ['items', params] as const,
  jobs: (params: Record<string, string | undefined>) => ['jobs', params] as const,
  jobStats: ['jobs', 'stats'] as const,
  job: (id: string) => ['jobs', 'one', id] as const,
  trackedJobs: ['jobs', 'tracked'] as const,
  courseContent: (id: string) => ['courses', id, 'content'] as const,
  grades: ['grades'] as const,
  courseGrades: (id: string) => ['grades', id] as const,
  fileSync: (id: string) => ['file-sync', id] as const,
  fileSyncDevices: ['file-sync', 'devices'] as const,
  systemVersion: ['system', 'version'] as const,
  updateStatus: ['system', 'update'] as const,
};

/** Widgets poll on this cadence while the tab is visible. */
export const WIDGET_POLL_MS = 60_000;
const poll = { refetchInterval: WIDGET_POLL_MS, refetchIntervalInBackground: false } as const;

export function useHealth() {
  return useQuery({ queryKey: qk.health, queryFn: () => api<HealthResponse>('/health'), refetchInterval: 30_000 });
}

export function useSources(opts?: Partial<UseQueryOptions<Source[]>>) {
  return useQuery({ queryKey: qk.sources, queryFn: () => api<Source[]>('/sources'), ...poll, ...opts });
}

export interface SourceSummary {
  id: SourceId;
  status: string;
  lastError: string | null;
  lastRun: { at: string; ms: number; counts: Record<string, number> } | null;
  byCourse: { courseId: string; code: string; role: string; linkedId: string | null; kinds: Record<string, number>; content: Record<string, number> }[];
  unassigned: Record<string, number>;
  recent: { id: string; kind: string; title: string; courseId: string | null; dueAt: string | null; startsAt: string | null; status: string; url: string | null; updatedAt: string; labels: string[] }[];
  jobs: { total: number; matched: number } | null;
  total: number;
}

export function useSourceSummary(id: SourceId, enabled: boolean) {
  return useQuery({ queryKey: ['sources', id, 'summary'] as const, queryFn: () => api<SourceSummary>(`/sources/${id}/summary`), enabled, staleTime: 15_000 });
}

export function useCourses() {
  return useQuery({ queryKey: qk.courses, queryFn: () => api<Course[]>('/courses'), staleTime: 60_000 });
}

export function useLayout() {
  return useQuery({ queryKey: qk.layout, queryFn: () => api<Layouts>('/layout'), staleTime: Infinity });
}

export function useWidgets() {
  return useQuery({ queryKey: qk.widgets, queryFn: () => api<WidgetInstance[]>('/widgets'), staleTime: Infinity });
}

export interface CourseContentRow {
  id: string;
  courseId: string;
  kind: string;
  externalId: string;
  moduleName: string | null;
  title: string;
  url: string | null;
  position: number | null;
  raw: Record<string, unknown>;
  updatedAt: string;
}

export function useCourseContent(courseId: string | undefined) {
  return useQuery({
    queryKey: qk.courseContent(courseId ?? ''),
    queryFn: () => api<CourseContentRow[]>(`/courses/${encodeURIComponent(courseId!)}/content`),
    enabled: !!courseId,
    staleTime: 5 * 60_000,
  });
}

export type GradesSummary = Record<string, { current: number | null; weighted: boolean; graded: number; total: number; canvasCurrent: number | null }>;

/** Current grade per course, for overview rows. */
export function useGradesSummary() {
  return useQuery({ queryKey: qk.grades, queryFn: () => api<GradesSummary>('/grades'), ...poll, staleTime: 60_000 });
}

export function useCourseGrades(courseId: string | undefined) {
  return useQuery({ queryKey: qk.courseGrades(courseId ?? ''), queryFn: () => api<CourseGrades>(`/grades/${encodeURIComponent(courseId!)}`), enabled: !!courseId, staleTime: 30_000 });
}

export interface CourseLinksResponse {
  canvas: { id: string; title: string; dueAt: string | null; status: string; url: string | null }[];
  gradescope: { id: string; title: string; dueAt: string | null; status: string; url: string | null }[];
  links: { a: string; b: string; method: 'auto' | 'manual'; confidence: number | null }[];
}

export function useCourseLinks(courseId: string | undefined) {
  return useQuery({
    queryKey: ['courses', courseId ?? '', 'links'] as const,
    queryFn: () => api<CourseLinksResponse>(`/courses/${encodeURIComponent(courseId!)}/links`),
    enabled: !!courseId,
  });
}

export function useLinkItems() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ a, b, unlink }: { a: string; b: string; unlink?: boolean }) => api(`/items/${unlink ? 'unlink' : 'link'}`, { method: 'POST', json: { a, b } }),
    onSettled: () => inv(['courses'], ['items']),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api<Record<string, unknown>>('/settings'), staleTime: 60_000 });
}

export interface ItemsParams {
  from?: string;
  to?: string;
  kind?: ItemKind[];
  source?: SourceId[];
  course?: string;
  includeDone?: boolean;
  includeHidden?: boolean;
  includeInformational?: boolean;
  limit?: number;
}

function itemsQuery(p: ItemsParams): Record<string, string | undefined> {
  return {
    from: p.from,
    to: p.to,
    kind: p.kind?.join(','),
    source: p.source?.join(','),
    course: p.course,
    includeDone: p.includeDone ? '1' : undefined,
    includeHidden: p.includeHidden ? '1' : undefined,
    includeInformational: p.includeInformational ? '1' : undefined,
    limit: p.limit?.toString(),
  };
}

export function toQueryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useItems(p: ItemsParams, enabled = true) {
  const params = itemsQuery(p);
  return useQuery({
    queryKey: qk.items(params),
    queryFn: () => api<EffectiveItem[]>(`/items${toQueryString(params)}`),
    enabled,
    ...poll,
  });
}

export interface JobsParams {
  state?: JobStateValue[];
  matchesOnly?: boolean;
  includeHidden?: boolean;
  since?: string;
  limit?: number;
}

export function useJobs(p: JobsParams, enabled = true) {
  const params = {
    state: p.state?.join(','),
    matchesOnly: p.matchesOnly === false ? '0' : undefined,
    includeHidden: p.includeHidden ? '1' : undefined,
    since: p.since,
    limit: p.limit?.toString(),
  };
  return useQuery({ queryKey: qk.jobs(params), queryFn: () => api<Job[]>(`/jobs${toQueryString(params)}`), enabled, ...poll });
}

export function useJobStats() {
  return useQuery({
    queryKey: qk.jobStats,
    queryFn: () => api<{ total: number; active: number; matched: number; unseen: number; tracked: number }>('/jobs/stats'),
    ...poll,
  });
}

export function useJob(id: string | null) {
  return useQuery({ queryKey: qk.job(id ?? ''), queryFn: () => api<Job>(`/jobs/${encodeURIComponent(id!)}`), enabled: !!id, staleTime: 15_000 });
}

/** Everything saved or applied to, feed and manual, most recently touched first. */
export function useTrackedJobs() {
  return useQuery({ queryKey: qk.trackedJobs, queryFn: () => api<Job[]>('/jobs/tracked'), ...poll });
}

/* ---------- mutations ---------- */

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export interface SyncAllResult {
  started: SourceId[];
  skipped: { id: SourceId; reason: 'running' | 'disabled' }[];
}

/** Kicks off every enabled source; the server answers before they finish. Poll `useSources` and watch `running`. */
export function useSyncAll() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<SyncAllResult>('/sources/sync', { method: 'POST' }),
    onSettled: () => inv(qk.sources),
  });
}

export function useSyncSource() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: SourceId) => api<{ outcome: unknown; source: Source }>(`/sources/${id}/sync`, { method: 'POST' }),
    onSettled: () => inv(qk.sources, ['items'], ['jobs'], qk.courses),
  });
}

export function useSaveLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layouts: Layouts) => api<{ ok: true }>('/layout', { method: 'PUT', json: layouts }),
    onMutate: async (layouts) => {
      await qc.cancelQueries({ queryKey: qk.layout });
      qc.setQueryData<Layouts>(qk.layout, (prev) => ({ ...(prev ?? {}), ...layouts }));
    },
  });
}

export function useResetLayout() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => api<{ ok: true }>('/layout', { method: 'DELETE' }), onSettled: () => inv(qk.layout) });
}

export function useUpsertWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: { id: string; type?: string; config?: Record<string, unknown>; hidden?: boolean }) =>
      api<WidgetInstance>(`/widgets/${encodeURIComponent(w.id)}`, { method: 'PUT', json: { type: w.type, config: w.config, hidden: w.hidden } }),
    onMutate: async (w) => {
      await qc.cancelQueries({ queryKey: qk.widgets });
      qc.setQueryData<WidgetInstance[]>(qk.widgets, (prev) => {
        const list = prev ?? [];
        const i = list.findIndex((x) => x.id === w.id);
        if (i === -1) {
          return w.type ? [...list, { id: w.id, type: w.type, config: w.config ?? {}, hidden: w.hidden ?? false, createdAt: new Date().toISOString() }] : list;
        }
        const next = [...list];
        next[i] = { ...list[i]!, ...(w.config ? { config: w.config } : {}), ...(w.hidden !== undefined ? { hidden: w.hidden } : {}) };
        return next;
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.widgets }),
  });
}

export function useSaveCourse() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CourseInput> & { id?: string }) =>
      id ? api<Course>(`/courses/${id}`, { method: 'PUT', json: body }) : api<Course>('/courses', { method: 'POST', json: body }),
    onSettled: () => inv(qk.courses, qk.widgets, qk.grades, ['file-sync']),
  });
}

/* ---------- file sync (course files → laptop) ---------- */

export function useFileSyncCourse(courseId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.fileSync(courseId ?? ''),
    queryFn: () => api<FileSyncManifestCourse>(`/file-sync/courses/${encodeURIComponent(courseId!)}`),
    enabled: !!courseId && enabled,
    staleTime: 30_000,
  });
}

export function useFileSyncDevices() {
  return useQuery({ queryKey: qk.fileSyncDevices, queryFn: () => api<FileSyncDevice[]>('/file-sync/devices'), staleTime: 30_000 });
}

/** Manual override for one file: a target name, 'skip', or null for back to rules/model. */
export function useSetFileSyncTarget() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ courseId, fileId, target }: { courseId: string; fileId: string; target: string | null }) =>
      api<FileSyncFileView>(`/file-sync/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`, { method: 'PUT', json: { target } }),
    onSettled: () => inv(['file-sync']),
  });
}

export function useDeleteCourse() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/courses/${id}`, { method: 'DELETE' }),
    onSettled: () => inv(qk.courses, qk.widgets),
  });
}

export function useSaveSetting() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api<unknown>(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', json: value }),
    onSettled: () => inv(qk.settings),
  });
}

export function useSaveSourceConfig() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, config }: { id: SourceId; config: Record<string, unknown> }) => api<Source>(`/sources/${id}/config`, { method: 'PUT', json: config }),
    onSettled: () => inv(qk.sources),
  });
}

export function useClearSourceConfig() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: SourceId) => api<Source>(`/sources/${id}/config`, { method: 'DELETE' }),
    onSettled: () => inv(qk.sources),
  });
}

/** Clears the Todoist token and, for an OAuth connection, revokes it at Todoist. */
export function useDisconnectTodoist() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<{ ok: true; revoked: boolean }>('/todoist/disconnect', { method: 'POST' }),
    onSettled: () => inv(qk.sources),
  });
}

export function useSetSourceEnabled() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: SourceId; enabled: boolean }) => api<Source>(`/sources/${id}/enabled`, { method: 'PUT', json: { enabled } }),
    onSettled: () => inv(qk.sources),
  });
}

export function usePatchSourceMeta() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, meta }: { id: SourceId; meta: Record<string, unknown> }) => api<Source>(`/sources/${id}/meta`, { method: 'PATCH', json: meta }),
    onSettled: () => inv(qk.sources),
  });
}

export function useSetOverride() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; hidden?: boolean; done?: boolean; snoozedUntil?: string | null; note?: string | null }) =>
      api(`/items/${encodeURIComponent(id)}/override`, { method: 'POST', json: body }),
    onSettled: () => inv(['items']),
  });
}

export function useCreateManualEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: ManualEventInput) => api<{ id: string; externalId: string }>('/items/manual', { method: 'POST', json: body }),
    onSettled: () => inv(['items']),
  });
}

export function useUpdateManualEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ externalId, ...body }: ManualEventInput & { externalId: string }) => api(`/items/manual/${encodeURIComponent(externalId)}`, { method: 'PUT', json: body }),
    onSettled: () => inv(['items']),
  });
}

export function useDeleteManualEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (externalId: string) => api<{ ok: true }>(`/items/manual/${encodeURIComponent(externalId)}`, { method: 'DELETE' }),
    onSettled: () => inv(['items']),
  });
}

export function useCreateEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { title: string; allDay: boolean; start: string; end?: string; calendarId?: string; description?: string; location?: string }) =>
      api<EffectiveItem>('/calendar/events', { method: 'POST', json: body }),
    onSettled: () => inv(['items']),
  });
}

export interface PushPlan {
  ops: { op: 'create' | 'update' | 'close' | 'delete'; itemId: string; title: string; taskId?: string; reason: string }[];
  projectId: string | null;
  projectName: string;
  candidates: number;
  mapped: number;
  rebuilt: number;
  skipped: { itemId: string; reason: string }[];
}

export function useTodoistPush() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (opts: { dryRun?: boolean; force?: boolean }) =>
      api<{ plan: PushPlan; done?: Record<string, number>; errors?: { error: string }[] }>(`/todoist/push?${opts.dryRun ? 'dryRun=1' : ''}${opts.force ? '&force=1' : ''}`, { method: 'POST' }),
    onSettled: (_d, _e, v) => (v.dryRun ? Promise.resolve() : inv(['items'], qk.sources, qk.settings, ['todo', 'status'])),
  });
}

export const GTASKS_PUSH_DEFAULTS: GtasksPushConfig = { enabled: false, listName: 'School', titlePrefix: 'course' };
export type PushResult = { plan: PushPlan; done?: Record<string, number>; errors?: { error: string }[] };

/** Connection and push state of both to-do apps. Null when the server doesn't have the route yet. */
export function useTodoStatus() {
  return useQuery({
    queryKey: ['todo', 'status'] as const,
    queryFn: () => api<TodoStatus>('/todo/status').catch(() => null),
    ...poll,
  });
}

/** `gtasks.push`. Null when the route is missing, so the page can fall back to the raw setting. */
export function useGtasksConfig() {
  return useQuery({
    queryKey: ['gtasks', 'config'] as const,
    queryFn: () => api<GtasksPushConfig>('/gtasks/config').catch(() => null),
    staleTime: 60_000,
  });
}

export function useSaveGtasksConfig() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (cfg: GtasksPushConfig) => api<GtasksPushConfig>('/gtasks/config', { method: 'PUT', json: cfg }),
    onSettled: () => inv(['gtasks', 'config'], ['todo', 'status'], qk.settings),
  });
}

export function useGtasksPush() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (opts: { dryRun?: boolean; force?: boolean }) =>
      api<PushResult>(`/gtasks/push?${opts.dryRun ? 'dryRun=1' : ''}${opts.force ? '&force=1' : ''}`, { method: 'POST' }),
    onSettled: (_d, _e, v) => (v.dryRun ? Promise.resolve() : inv(['items'], qk.sources, qk.settings, ['todo', 'status'])),
  });
}

/** Close a task in the app it came from (Todoist or Google Tasks). `externalId` is the item's external id. */
export function useCloseTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ source, externalId }: { source: TodoApp; externalId: string }) => api(`/${source}/tasks/${encodeURIComponent(externalId)}/close`, { method: 'POST' }),
    onSettled: () => inv(['items']),
  });
}

/** Add a task to the default to-do app. Todoist parses dates and labels out of the text; Google Tasks takes it as the title. */
export function useQuickAddTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ app, text }: { app: TodoApp; text: string }) =>
      app === 'gtasks' ? api<EffectiveItem>('/gtasks/tasks/quick', { method: 'POST', json: { content: text } }) : api<EffectiveItem>('/todoist/tasks/quick', { method: 'POST', json: { text } }),
    onSettled: () => inv(['items']),
  });
}

export function useMarkJobsSeen() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (ids: string[]) => api('/jobs/seen', { method: 'PATCH', json: { ids } }),
    onSettled: () => inv(qk.jobStats),
  });
}

export interface JobStatePatch {
  id: string;
  state?: JobStateValue;
  notes?: string | null;
  appliedAt?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
  resumePath?: string | null;
}

export function usePatchJobState() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: JobStatePatch) => api<Job>(`/jobs/${encodeURIComponent(id)}/state`, { method: 'PATCH', json: body }),
    onSuccess: (job) => qc.setQueryData(qk.job(job.id), job),
    onSettled: () => inv(['jobs']),
  });
}

export function useCreateJob() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: ManualJobInput) => api<Job>('/jobs', { method: 'POST', json: body }),
    onSettled: () => inv(['jobs']),
  });
}

export function useDeleteJob() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSettled: () => inv(['jobs']),
  });
}

// --- sign-in ---------------------------------------------------------------------------------------------------------

/** Who the browser is, from the server's point of view. Answers for signed-out visitors too (user: null). */
export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/auth/me'), staleTime: 60_000, retry: 1 });
}

/** A person is signed in (or auth is off for local development). Machine identities do not count. */
export const isSignedIn = (me: Me | undefined): boolean => !!me && (me.authDisabled || !!me.user);

export function useTokens() {
  return useQuery({ queryKey: qk.tokens, queryFn: () => api<ApiToken[]>('/auth/tokens'), retry: false });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<ApiToken & { token: string }>('/auth/tokens', { method: 'POST', json: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
}

/** Ends the session. The cache is left to the caller (lib/useSignOut.ts), which has to leave the page first. */
export function useLogout() {
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/auth/logout', { method: 'POST', json: {} }),
  });
}

// --- onboarding ------------------------------------------------------------------------------------------------------

export function useCanvasEnrollments(enabled = true) {
  return useQuery({ queryKey: ['onboarding', 'canvas'] as const, queryFn: () => api<{ connected: boolean; courses: CanvasEnrollment[] }>('/onboarding/canvas'), enabled, retry: false, staleTime: 60_000 });
}

export function useImportCanvasCourses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { courses: { canvasCourseId: string; term: string; code: string; section?: string | null; name?: string | null; role: Course['role'] }[] }) =>
      api<{ created: string[]; skipped: { canvasCourseId: string; reason: string }[] }>('/onboarding/canvas', { method: 'POST', json: body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.courses });
      await qc.invalidateQueries({ queryKey: qk.widgets });
      await qc.invalidateQueries({ queryKey: ['onboarding', 'canvas'] });
    },
  });
}

/** The running build. Fixed for the life of the process, so it is never refetched. */
export function useSystemVersion() {
  return useQuery({ queryKey: qk.systemVersion, queryFn: () => api<SystemVersion>('/system/version'), staleTime: Infinity, retry: false });
}

/** How far this build is behind upstream main. The server caches the comparison; the page asks again every 10 minutes. */
export function useUpdateStatus() {
  return useQuery({ queryKey: qk.updateStatus, queryFn: () => api<UpdateStatus>('/system/update'), staleTime: 10 * 60_000, refetchInterval: 10 * 60_000, refetchIntervalInBackground: false, retry: false });
}

/** Ask the server to compare with upstream now instead of waiting for its schedule. */
export function useCheckForUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<UpdateStatus>('/system/update/check', { method: 'POST', json: {} }),
    onSuccess: (status) => qc.setQueryData(qk.updateStatus, status),
  });
}
