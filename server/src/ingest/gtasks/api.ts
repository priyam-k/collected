/** Google Tasks API v1 shapes (only what we use). https://developers.google.com/tasks/reference/rest */

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';

export interface GTaskList {
  id: string;
  title: string;
  updated?: string | null;
}

export interface GTask {
  id: string;
  title?: string | null;
  notes?: string | null;
  /** `needsAction` or `completed`. */
  status?: string | null;
  /** RFC3339, but only the date part is meaningful: the API discards the time. */
  due?: string | null;
  completed?: string | null;
  deleted?: boolean | null;
  hidden?: boolean | null;
  parent?: string | null;
  position?: string | null;
  updated?: string | null;
  webViewLink?: string | null;
  selfLink?: string | null;
}

export interface NewGTask {
  title: string;
  notes?: string;
  /** RFC3339 at midnight UTC of the due day. */
  due?: string;
}

/** Most tasks fetched per list in one run. A list that reaches the cap is treated as incomplete (no deletions). */
export const MAX_TASKS_PER_LIST = 500;

export interface GTasksApi {
  listTaskLists(): Promise<GTaskList[]>;
  /** Every task in a list, completed and hidden included, paginated internally up to MAX_TASKS_PER_LIST. */
  listTasks(listId: string): Promise<{ tasks: GTask[]; truncated: boolean }>;
  insertTask(listId: string, body: NewGTask): Promise<GTask>;
  completeTask(listId: string, taskId: string): Promise<GTask>;
}

/** Google's list and task ids are base64url-ish; anything else is refused before it reaches a URL path. */
export const GTASKS_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** `<listId>:<taskId>` → parts, or null when either part is not a plausible id. */
export function splitExternalId(externalId: string): { listId: string; taskId: string } | null {
  const i = externalId.indexOf(':');
  if (i < 0) return null;
  const listId = externalId.slice(0, i);
  const taskId = externalId.slice(i + 1);
  return GTASKS_ID_RE.test(listId) && GTASKS_ID_RE.test(taskId) ? { listId, taskId } : null;
}
