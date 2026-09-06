import { Link } from 'react-router';
import { useHealth } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

export function DashboardPage() {
  const health = useHealth();
  const { theme, setTheme } = useTheme();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">collected</h1>
        <nav className="flex items-center gap-3 text-sm">
          <select
            className="rounded-md border bg-background px-2 py-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
            aria-label="Theme"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <Link className="underline-offset-4 hover:underline" to="/settings">
            Settings
          </Link>
        </nav>
      </header>
      <section className="mt-8 rounded-lg border p-4 text-sm">
        {health.isPending && <p className="text-muted-foreground">Checking server…</p>}
        {health.isError && <p className="text-destructive">Server unreachable: {health.error.message}</p>}
        {health.data && (
          <p>
            Server ok · v{health.data.version} · {new Date(health.data.now).toLocaleTimeString()}
            {health.data.authDisabled && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">auth disabled</span>}
          </p>
        )}
      </section>
    </main>
  );
}
