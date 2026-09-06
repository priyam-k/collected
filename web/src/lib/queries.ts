import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  Course,
  CourseInput,
  EffectiveItem,
  HealthResponse,
  ItemKind,
  Job,
  JobStateValue,
  Layouts,
  Source,
  SourceId,
  WidgetInstance,
} from '@collected/shared';
import { api } from './api';

export const qk = {
  health: ['health'] as const,
  sources: ['sources'] as const,
  courses: ['courses'] as const,
  layout: ['layout'] as const,
  widgets: ['widgets'] as const,
  settings: ['settings'] as const,
  items: (params: Record<string, string | undefined>) => ['items', params] as const,
  jobs: (params: Record<string, string | undefined>) => ['jobs', params] as const,
  jobStats: ['jobs', 'stats'] as const,
  courseContent: (id: string) => ['courses', id, 'content'] as const,
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

export function useCourses() {
  return useQuery({ queryKey: qk.courses, queryFn: () => api<Course[]>('/courses'), staleTime: 60_000 });
}

export function useLayout() {
  return useQuery({ queryKey: qk.layout, queryFn: () => api<Layouts>('/layout'), staleTime: Infinity });
}

export function useWidgets() {
  return useQuery({ queryKey: qk.widgets, queryFn: () => api<WidgetInstance[]>('/widgets'), staleTime: Infinity });
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
    queryFn: () => api<{ total: number; active: number; matched: number; unseen: number }>('/jobs/stats'),
    ...poll,
  });
}

/* ---------- mutations ---------- */

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
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
    onSettled: () => inv(qk.courses, qk.widgets),
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

export function usePatchJobState() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, state, notes }: { id: string; state?: JobStateValue; notes?: string | null }) =>
      api(`/jobs/${encodeURIComponent(id)}/state`, { method: 'PATCH', json: { state, notes } }),
    onSettled: () => inv(['jobs']),
  });
}
