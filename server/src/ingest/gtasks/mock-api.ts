import type { GTask, GTaskList, GTasksApi, NewGTask } from './api.js';

/** In-memory Google Tasks. Records operations; `fail` makes one list's fetch throw. */
export class MockGTasksApi implements GTasksApi {
  lists: GTaskList[];
  tasks: Record<string, GTask[]>;
  fail = new Set<string>();
  ops: string[] = [];
  private seq = 1;

  constructor(seed: { lists: GTaskList[]; tasks: Record<string, GTask[]> }) {
    const copy = structuredClone(seed);
    this.lists = copy.lists;
    this.tasks = copy.tasks;
  }

  async listTaskLists() {
    return this.lists;
  }
  async listTasks(listId: string) {
    if (this.fail.has(listId)) throw new Error(`mock: list ${listId} failed`);
    return { tasks: this.tasks[listId] ?? [], truncated: false };
  }
  async insertTask(listId: string, body: NewGTask) {
    const id = listId === '@default' ? this.lists[0]!.id : listId;
    const t: GTask = { id: `new${this.seq++}`, title: body.title, notes: body.notes ?? null, due: body.due ?? null, status: 'needsAction', selfLink: `https://www.googleapis.com/tasks/v1/lists/${id}/tasks/new${this.seq - 1}` };
    (this.tasks[id] ??= []).push(t);
    this.ops.push(`insertTask ${id} ${body.title}`);
    return t;
  }
  async completeTask(listId: string, taskId: string) {
    const t = (this.tasks[listId] ?? []).find((x) => x.id === taskId);
    if (!t) throw new Error(`mock: no task ${listId}/${taskId}`);
    t.status = 'completed';
    t.completed = new Date().toISOString();
    this.ops.push(`completeTask ${listId} ${taskId}`);
    return t;
  }
  async insertTaskList(title: string) {
    const l: GTaskList = { id: `list${this.seq++}`, title };
    this.lists.push(l);
    this.tasks[l.id] = [];
    this.ops.push(`insertTaskList ${title}`);
    return l;
  }
  async updateTask(listId: string, taskId: string, body: Partial<NewGTask>) {
    const t = (this.tasks[listId] ?? []).find((x) => x.id === taskId);
    if (!t) throw new Error(`mock: no task ${listId}/${taskId}`);
    if (body.title !== undefined) t.title = body.title;
    if (body.notes !== undefined) t.notes = body.notes;
    if (body.due !== undefined) t.due = body.due;
    this.ops.push(`updateTask ${listId} ${taskId}`);
    return t;
  }
  async deleteTask(listId: string, taskId: string) {
    const list = this.tasks[listId] ?? [];
    if (!list.some((x) => x.id === taskId)) throw new Error(`mock: no task ${listId}/${taskId}`);
    this.tasks[listId] = list.filter((x) => x.id !== taskId);
    this.ops.push(`deleteTask ${listId} ${taskId}`);
  }
}
