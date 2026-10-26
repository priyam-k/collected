import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dashboard } from '@/dashboard/Dashboard';
import { EditModeProvider } from '@/dashboard/EditMode';
import { useCourses, useSources } from '@/lib/queries';

/** Shown above the board until there is at least one course: the two steps that make the dashboard mean something. */
function FirstRun() {
  const sources = useSources();
  const canvas = sources.data?.find((s) => s.id === 'canvas');
  const canvasOk = canvas?.status === 'connected';
  return (
    <section aria-label="Set up" className="mx-auto mb-4 max-w-3xl rounded-2xl border border-line2 bg-card p-5 shadow-[var(--shadow)]">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Welcome. Two steps and the board fills itself.</h2>
      <ol className="mt-3 space-y-3 text-[13px]">
        <li className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${canvasOk ? 'bg-emerald-500/20 text-emerald-500' : 'bg-well2 text-ink'}`}>{canvasOk ? '✓' : '1'}</span>
          <div>
            <div className="font-medium">Connect Canvas</div>
            <div className="text-sub">
              On your laptop: <code className="rounded bg-well px-1">npm i -g collected-cli</code>, then <code className="rounded bg-well px-1">collected init &lt;this url&gt;</code>, <code className="rounded bg-well px-1">collected login</code> and{' '}
              <code className="rounded bg-well px-1">collected connect canvas</code>. Or paste a session cookie under <Link to="/settings/sources" className="underline">Sources</Link>.
            </div>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-well2 text-xs font-semibold text-ink">2</span>
          <div>
            <div className="font-medium">Pick your courses</div>
            <div className="text-sub">Import them from your Canvas enrollments, or add them by hand.</div>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm">
                <Link to="/settings/courses">Import from Canvas</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/sources">Connect other sources</Link>
              </Button>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

export function DashboardPage() {
  const courses = useCourses();
  return (
    <EditModeProvider>
      {courses.data && courses.data.length === 0 && <FirstRun />}
      <Dashboard />
    </EditModeProvider>
  );
}
