import { bootstrap } from './bootstrap.js';

const [cmd, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log(`usage:
  cli seed                 re-run seeding (idempotent)
  cli sync <source|all>    run an ingester now (M2+)
  cli export               print config export JSON (M2+)
  cli import <file>        import config JSON (M2+)`);
  process.exit(cmd ? 1 : 0);
}

const ctx = await bootstrap({ quiet: false });

switch (cmd) {
  case 'seed':
    ctx.log.info('seed complete');
    break;
  case 'sync':
  case 'export':
  case 'import':
    ctx.log.warn({ cmd, args: rest }, 'not implemented yet');
    process.exit(2);
  default:
    usage();
}
process.exit(0);
