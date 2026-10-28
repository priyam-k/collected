import { readFileSync } from 'node:fs';
import { applyImport, buildExport, importSchema } from './api/export.js';
import { bootstrap } from './bootstrap.js';
import { getIngester, ingesters } from './ingest/registry.js';
import { runIngester } from './ingest/runner.js';

const [cmd, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log(`usage:
  cli seed                 re-run seeding (idempotent)
  cli sync <source|all>    run an ingester now, ignoring the enabled flag
  cli export               print config export JSON
  cli import <file>        import config JSON (courses, settings, widgets, layouts)
  cli demo <canvas|gradescope|gcal|todoist|gtasks>  load fixtures into this database (UI development without a session)
  cli demo clear           remove everything the demo loaders created
  cli push [todoist|gtasks] [--dry-run]  run the assignment push into that app now (default todoist; ignores the enabled flag)
  cli dedup                re-run Canvas/Gradescope assignment linking`);
  process.exit(cmd ? 1 : 0);
}

if (!cmd) usage();
const ctx = await bootstrap({ quiet: cmd === 'export' });

switch (cmd) {
  case 'seed':
    ctx.log.info('seed complete');
    break;
  case 'sync': {
    const which = rest[0];
    if (!which) usage();
    const list = which === 'all' ? ingesters : [getIngester(which)].filter((x): x is NonNullable<typeof x> => !!x);
    if (!list.length) {
      console.error(`unknown source "${which}". known: ${ingesters.map((i) => i.id).join(', ')}`);
      process.exit(1);
    }
    let failed = false;
    for (const ing of list) {
      const outcome = await runIngester(ctx, ing, { force: true });
      console.log(JSON.stringify({ source: ing.id, ...outcome }));
      if (!outcome.ok && !('skipped' in outcome)) failed = true;
    }
    process.exit(failed ? 1 : 0);
  }
  case 'export':
    console.log(JSON.stringify(await buildExport(ctx), null, 2));
    break;
  case 'demo': {
    const demoStartedAt = new Date().toISOString();
    const { clearDemoData, tagDemoRows } = await import('./lib/demo.js');
    if (rest[0] === 'clear') {
      console.log(JSON.stringify(await clearDemoData(ctx)));
      break;
    }
    if (rest[0] === 'canvas') {
      const { fixtureCanvasClient } = await import('./ingest/canvas/fixture-client.js');
      const { syncCanvas } = await import('./ingest/canvas/ingest.js');
      console.log(JSON.stringify(await syncCanvas(ctx, fixtureCanvasClient())));
    } else if (rest[0] === 'gradescope') {
      const { fixtureGradescopeClient } = await import('./ingest/gradescope/fixture-client.js');
      const { syncGradescope } = await import('./ingest/gradescope/ingest.js');
      console.log(JSON.stringify(await syncGradescope(ctx, fixtureGradescopeClient())));
    } else if (rest[0] === 'gcal') {
      const { MockCalendarApi, demoCalendars, demoScript } = await import('./ingest/gcal/mock-api.js');
      const { syncGcal } = await import('./ingest/gcal/ingest.js');
      const { mergeSourceMeta, setSourceStatus, getSourceRow } = await import('./lib/sources.js');
      const api = new MockCalendarApi(demoCalendars, demoScript());
      const row = await getSourceRow(ctx, 'gcal');
      const { counts, meta } = await syncGcal(ctx, api, { ...(row.meta as object), selectedCalendars: demoCalendars.map((c) => c.id), syncTokens: {} });
      await mergeSourceMeta(ctx, 'gcal', { ...meta, defaultCalendarId: demoCalendars[0]!.id, demo: true });
      await setSourceStatus(ctx, 'gcal', 'connected', { lastSuccessAt: new Date().toISOString(), lastError: null });
      console.log(JSON.stringify(counts));
    } else if (rest[0] === 'todoist') {
      const { MockTodoistApi } = await import('./ingest/todoist/mock-api.js');
      const { syncTodoist } = await import('./ingest/todoist/ingest.js');
      const { setSourceStatus, mergeSourceMeta } = await import('./lib/sources.js');
      const day = (d: number, h = 18) => {
        const x = new Date();
        x.setDate(x.getDate() + d);
        x.setHours(h, 0, 0, 0);
        return x;
      };
      const api = new MockTodoistApi({
        projects: [{ id: 'p-school', name: 'School' }, { id: 'p-home', name: 'Home' }],
        labels: [{ id: 'l1', name: 'homework' }, { id: 'l2', name: 'grocery' }, { id: 'l3', name: 'cleaning' }, { id: 'l4', name: 'errands' }],
        tasks: [
          { id: 'd1', content: 'Buy oat milk', project_id: 'p-home', labels: ['grocery'], priority: 1, due: { date: day(0).toISOString().slice(0, 10) } },
          { id: 'd2', content: 'Eggs, spinach, rice', project_id: 'p-home', labels: ['grocery'], priority: 1, due: null },
          { id: 'd3', content: 'Vacuum + take out trash', project_id: 'p-home', labels: ['cleaning'], priority: 2, due: { date: day(1).toISOString().slice(0, 10), datetime: day(1, 10).toISOString() } },
          { id: 'd4', content: 'Renew parking permit', project_id: 'p-home', labels: ['errands'], priority: 3, due: { date: day(3).toISOString().slice(0, 10) } },
          { id: 'd5', content: 'Email advisor about spring schedule', project_id: 'p-school', labels: [], priority: 2, due: { date: day(2).toISOString().slice(0, 10), datetime: day(2, 9).toISOString() } },
          { id: 'd6', content: 'Read CIML ch. 1', project_id: 'p-school', labels: ['homework', 'cmsc422'], priority: 1, due: { date: day(1).toISOString().slice(0, 10), datetime: day(1, 23).toISOString() } },
          { id: 'd7', content: 'Call mom', project_id: 'inbox', labels: [], priority: 4, due: { date: day(0).toISOString().slice(0, 10) } },
          { id: 'd8', content: 'Wipe counters', project_id: 'p-home', parent_id: 'd3', labels: [], priority: 1, due: null },
          { id: 'd9', content: 'Mop kitchen', project_id: 'p-home', parent_id: 'd3', labels: [], priority: 1, due: { date: day(1).toISOString().slice(0, 10) } },
        ],
      });
      const counts = await syncTodoist(ctx, api);
      await mergeSourceMeta(ctx, 'todoist', { projects: api.projects.map((p) => ({ id: p.id, name: p.name })), labels: api.labels.map((l) => l.name), demo: true });
      await setSourceStatus(ctx, 'todoist', 'connected', { lastSuccessAt: new Date().toISOString(), lastError: null });
      console.log(JSON.stringify(counts));
    } else if (rest[0] === 'gtasks') {
      const { MockGTasksApi } = await import('./ingest/gtasks/mock-api.js');
      const { syncGtasks } = await import('./ingest/gtasks/ingest.js');
      const { setSourceStatus, mergeSourceMeta } = await import('./lib/sources.js');
      const day = (d: number) => {
        const x = new Date();
        x.setDate(x.getDate() + d);
        return `${x.toISOString().slice(0, 10)}T00:00:00.000Z`;
      };
      const t = (id: string, title: string, due: string | null, extra: Partial<import('./ingest/gtasks/api.js').GTask> = {}) => ({ id, title, notes: null, due, status: 'needsAction', selfLink: `https://www.googleapis.com/tasks/v1/lists/x/tasks/${id}`, ...extra });
      const api = new MockGTasksApi({
        lists: [{ id: 'g-school', title: 'School' }, { id: 'g-life', title: 'Life' }],
        tasks: {
          'g-school': [t('g1', 'Outline STAT410 project', day(2)), t('g2', 'Office hours: ask about problem 4', day(1)), t('g3', 'Reread lecture 12 notes', null)],
          'g-life': [t('g4', 'Book dentist', day(5)), t('g5', 'Return library books', day(0)), t('g6', 'Pay electric bill', day(3), { status: 'completed', completed: new Date().toISOString() })],
        },
      });
      const { counts, lists } = await syncGtasks(ctx, api);
      await mergeSourceMeta(ctx, 'gtasks', { lists: lists.map((l) => ({ id: l.id, title: l.title })), demo: true });
      await setSourceStatus(ctx, 'gtasks', 'connected', { lastSuccessAt: new Date().toISOString(), lastError: null });
      console.log(JSON.stringify(counts));
    } else usage();
    const sourceOf: Record<string, string> = { canvas: 'canvas', gradescope: 'gradescope', gcal: 'gcal', todoist: 'todoist', gtasks: 'gtasks' };
    const tagged = await tagDemoRows(ctx, sourceOf[rest[0]!]!, demoStartedAt);
    const { runDedup } = await import('./sync/dedup.js');
    console.log(JSON.stringify({ tagged, dedup: await runDedup(ctx), hint: 'remove with: cli demo clear (or Settings → Export / import → Remove demo data)' }));
    break;
  }
  case 'push': {
    const app = rest.find((a) => !a.startsWith('--')) ?? 'todoist';
    const dryRun = rest.includes('--dry-run');
    const { getSettingParsed } = await import('./lib/settings.js');
    const summary = (plan: { targetName: string; ops: { op: string; title: string; reason: string }[]; skipped: unknown[]; rebuilt: number }) =>
      JSON.stringify({ target: plan.targetName, ops: plan.ops.map((o) => `${o.op}: ${o.title}${o.reason ? ` (${o.reason})` : ''}`), skipped: plan.skipped.length, rebuilt: plan.rebuilt }, null, 2);
    if (app === 'todoist') {
      const { todoistPushConfigSchema } = await import('@collected/shared');
      const { todoistApiForCtx } = await import('./ingest/todoist/ingest.js');
      const { executePush, planPush } = await import('./sync/todoist-push.js');
      const cfg = await getSettingParsed(ctx, 'todoist.push', todoistPushConfigSchema);
      const api = await todoistApiForCtx(ctx);
      const plan = await planPush(ctx, api, cfg);
      console.log(summary(plan));
      if (!dryRun) {
        const res = await executePush(ctx, api, plan, cfg);
        console.log(JSON.stringify({ done: res.done, errors: res.errors }));
      }
    } else if (app === 'gtasks') {
      const { gtasksPushConfigSchema } = await import('@collected/shared');
      const { gtasksApiForCtx } = await import('./ingest/gtasks/ingest.js');
      const { executeGtasksPush, planGtasksPush } = await import('./sync/gtasks-push.js');
      const cfg = await getSettingParsed(ctx, 'gtasks.push', gtasksPushConfigSchema);
      const api = await gtasksApiForCtx(ctx);
      const plan = await planGtasksPush(ctx, api, cfg);
      console.log(summary(plan));
      if (!dryRun) {
        const res = await executeGtasksPush(ctx, api, plan, cfg);
        console.log(JSON.stringify({ done: res.done, errors: res.errors }));
      }
    } else usage();
    break;
  }
  case 'dedup': {
    const { runDedup } = await import('./sync/dedup.js');
    console.log(JSON.stringify(await runDedup(ctx)));
    break;
  }
  case 'import': {
    const file = rest[0];
    if (!file) usage();
    const data = importSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    console.log(JSON.stringify(await applyImport(ctx, data)));
    break;
  }
  default:
    usage();
}
process.exit(0);
