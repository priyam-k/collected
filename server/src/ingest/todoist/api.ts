/** Todoist unified API v1 shapes (only what we use). Ids are opaque strings. */

export interface TProject {
  id: string;
  name: string;
  color?: string | null;
  is_inbox_project?: boolean;
  is_archived?: boolean;
}

export interface TSection {
  id: string;
  name: string;
  project_id: string;
}

export interface TLabel {
  id: string;
  name: string;
  color?: string | null;
}

export interface TDue {
  date: string; // YYYY-MM-DD
  datetime?: string | null; // RFC3339 (Z) or local "YYYY-MM-DDTHH:MM:SS" with timezone
  string?: string | null;
  timezone?: string | null;
  is_recurring?: boolean;
}

export interface TTask {
  id: string;
  content: string;
  description?: string | null;
  project_id: string;
  section_id?: string | null;
  parent_id?: string | null;
  labels: string[];
  priority?: number;
  due?: TDue | null;
  checked?: boolean; // v1 name
  is_completed?: boolean; // some responses
  completed_at?: string | null;
  added_at?: string | null;
  updated_at?: string | null;
}

export interface NewTaskBody {
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  labels?: string[];
  priority?: number;
  due_datetime?: string;
  due_date?: string;
  due_string?: string;
}

export type UpdateTaskBody = Partial<NewTaskBody>;

export interface TodoistApi {
  listProjects(): Promise<TProject[]>;
  createProject(name: string): Promise<TProject>;
  listSections(): Promise<TSection[]>;
  listLabels(): Promise<TLabel[]>;
  createLabel(name: string): Promise<TLabel>;
  /** All active tasks (paginated internally). */
  listTasks(params?: { projectId?: string }): Promise<TTask[]>;
  /** Tasks completed in [since, until] (ISO datetimes). */
  listCompleted(since: string, until: string): Promise<TTask[]>;
  createTask(body: NewTaskBody): Promise<TTask>;
  /** Natural-language add ("Read ch. 3 tomorrow 5pm @homework #School"). */
  quickAdd(text: string): Promise<TTask>;
  updateTask(id: string, body: UpdateTaskBody): Promise<TTask>;
  closeTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

export const isClosed = (t: TTask): boolean => !!(t.checked ?? t.is_completed ?? t.completed_at);
