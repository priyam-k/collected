import { spawn } from 'node:child_process';

/** Opens a URL in the default browser without waiting on it; a platform with none of the three openers just gets the printed URL. */
export function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no opener: the URL is on the terminal
  }
}
