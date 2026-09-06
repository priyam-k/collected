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
  cli demo <canvas|gradescope|gcal>  load fixtures into this database (UI development without a session)
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
    } else usage();
    const { runDedup } = await import('./sync/dedup.js');
    console.log(JSON.stringify({ dedup: await runDedup(ctx) }));
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
