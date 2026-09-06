import type { NewTaskBody, TLabel, TProject, TSection, TTask, TodoistApi, UpdateTaskBody } from './api.js';

/** In-memory Todoist. Records operations so tests can assert exactly what the push did. */
export class MockTodoistApi implements TodoistApi {
  projects: TProject[] = [{ id: 'inbox', name: 'Inbox', is_inbox_project: true }];
  sections: TSection[] = [];
  labels: TLabel[] = [];
  tasks: TTask[] = [];
  completed: TTask[] = [];
  ops: string[] = [];
  private seq = 1;

  constructor(seed?: { projects?: TProject[]; tasks?: TTask[]; completed?: TTask[]; labels?: TLabel[] }) {
    if (seed?.projects) this.projects.push(...seed.projects);
    if (seed?.tasks) this.tasks.push(...seed.tasks);
    if (seed?.completed) this.completed.push(...seed.completed);
    if (seed?.labels) this.labels.push(...seed.labels);
  }

  async listProjects() {
    return this.projects;
  }
  async createProject(name: string) {
    const p = { id: `p${this.seq++}`, name };
    this.projects.push(p);
    this.ops.push(`createProject ${name}`);
    return p;
  }
  async listSections() {
    return this.sections;
  }
  async listLabels() {
    return this.labels;
  }
  async createLabel(name: string) {
    const l = { id: `l${this.seq++}`, name };
    this.labels.push(l);
    this.ops.push(`createLabel ${name}`);
    return l;
  }
  async listTasks(params?: { projectId?: string }) {
    return this.tasks.filter((t) => !params?.projectId || t.project_id === params.projectId);
  }
  async listCompleted() {
    return this.completed;
  }
  async createTask(body: NewTaskBody) {
    const t: TTask = {
      id: `t${this.seq++}`,
      content: body.content,
      description: body.description ?? '',
      project_id: body.project_id ?? 'inbox',
      section_id: body.section_id ?? null,
      labels: body.labels ?? [],
      priority: body.priority ?? 1,
      due: body.due_datetime ? { date: body.due_datetime.slice(0, 10), datetime: body.due_datetime } : body.due_date ? { date: body.due_date } : null,
      checked: false,
    };
    this.tasks.push(t);
    this.ops.push(`createTask ${body.content}`);
    return t;
  }
  async quickAdd(text: string) {
    const labels = [...text.matchAll(/@(\w+)/g)].map((m) => m[1]!);
    const content = text.replace(/[@#]\w+/g, '').replace(/\s+/g, ' ').trim();
    return this.createTask({ content, labels });
  }
  async updateTask(id: string, body: UpdateTaskBody) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`mock: no task ${id}`);
    if (body.content !== undefined) t.content = body.content;
    if (body.description !== undefined) t.description = body.description;
    if (body.labels !== undefined) t.labels = body.labels;
    if (body.due_datetime !== undefined) t.due = { date: body.due_datetime.slice(0, 10), datetime: body.due_datetime };
    if (body.due_date !== undefined) t.due = { date: body.due_date };
    this.ops.push(`updateTask ${id}`);
    return t;
  }
  async closeTask(id: string) {
    const i = this.tasks.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(`mock: no task ${id}`);
    const [t] = this.tasks.splice(i, 1);
    this.completed.push({ ...t!, checked: true, completed_at: new Date().toISOString() });
    this.ops.push(`closeTask ${id}`);
  }
  async deleteTask(id: string) {
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this.ops.push(`deleteTask ${id}`);
  }
}
