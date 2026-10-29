import { readFileSync } from 'node:fs';
import { applyImport, buildExport, importSchema } from './api/export.js';
import { bootstrap } from './bootstrap.js';
import { getIngester, ingesters } from '@collected/core/ingest/registry';
import { runIngester } from '@collected/core/ingest/runner';

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
    const { clearDemoData, isDemoSource, loadDemo } = await import('@collected/core/lib/demo');
    if (rest[0] === 'clear') {
      console.log(JSON.stringify(await clearDemoData(ctx)));
      break;
    }
    if (!isDemoSource(rest[0])) usage();
    const loaded = await loadDemo(ctx, rest[0]);
    console.log(JSON.stringify({ ...loaded, hint: 'remove with: cli demo clear (or Settings → Export / import → Remove demo data)' }));
    break;
  }
  case 'push': {
    const app = rest.find((a) => !a.startsWith('--')) ?? 'todoist';
    const dryRun = rest.includes('--dry-run');
    const { getSettingParsed } = await import('@collected/core/lib/settings');
    const summary = (plan: { targetName: string; ops: { op: string; title: string; reason: string }[]; skipped: unknown[]; rebuilt: number }) =>
      JSON.stringify({ target: plan.targetName, ops: plan.ops.map((o) => `${o.op}: ${o.title}${o.reason ? ` (${o.reason})` : ''}`), skipped: plan.skipped.length, rebuilt: plan.rebuilt }, null, 2);
    if (app === 'todoist') {
      const { todoistPushConfigSchema } = await import('@collected/shared');
      const { todoistApiForCtx } = await import('@collected/core/ingest/todoist/ingest');
      const { executePush, planPush } = await import('@collected/core/sync/todoist-push');
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
      const { gtasksApiForCtx } = await import('@collected/core/ingest/gtasks/ingest');
      const { executeGtasksPush, planGtasksPush } = await import('@collected/core/sync/gtasks-push');
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
    const { runDedup } = await import('@collected/core/sync/dedup');
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
