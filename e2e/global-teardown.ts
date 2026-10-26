import { rmSync } from 'node:fs';

/** Stops the server started in global-setup and removes the temp directory (kept with E2E_KEEP=1). */
export default async function globalTeardown(): Promise<void> {
  const pid = Number(process.env.E2E_SERVER_PID);
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // exited on SIGTERM
    }
  }
  const tmp = process.env.E2E_TMP;
  if (tmp && !process.env.E2E_KEEP) rmSync(tmp, { recursive: true, force: true });
  else if (tmp) console.log(`[e2e] kept ${tmp}`);
}
