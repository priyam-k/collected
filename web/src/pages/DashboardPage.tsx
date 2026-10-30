import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dashboard } from '@/dashboard/Dashboard';
import { EditModeProvider } from '@/dashboard/EditMode';
import { useCourses, useSources } from '@/lib/queries';
import { cn } from '@/lib/utils';

const code = 'rounded-md bg-well px-1.5 py-px font-mono text-[12px] text-ink';

/** Shown above the board until there is at least one course: the two steps that make the dashboard mean something. */
function FirstRun() {
  const sources = useSources();
  const canvas = sources.data?.find((s) => s.id === 'canvas');
  const canvasOk = canvas?.status === 'connected';
  const step = (n: number, done: boolean) => (
    <span className={cn('mt-px grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold', done ? 'bg-[color-mix(in_srgb,var(--positive)_14%,var(--surface))] text-positive' : 'bg-well text-ink')}>
      {done ? <Check className="size-3.5" strokeWidth={2.4} /> : n}
    </span>
  );
  return (
    <section aria-label="Set up" className="surface mx-auto mb-2 mt-6 w-[calc(100%-2rem)] max-w-3xl p-6 sm:p-7">
      <p className="label">Getting started</p>
      <h2 className="mt-2 text-[26px] font-[620] leading-tight tracking-[-0.025em]">Two steps and the board fills itself.</h2>
      <ol className="mt-5 space-y-5 text-[14px]">
        <li className="flex items-start gap-3.5">
          {step(1, canvasOk)}
          <div>
            <div className="font-semibold">Connect Canvas {canvasOk && <span className="ml-1 font-medium text-positive">Connected</span>}</div>
            <div className="mt-1 leading-relaxed text-sub">
              On your laptop: <code className={code}>npm i -g collected-cli</code>, then <code className={code}>collected init {window.location.origin}</code>, <code className={code}>collected login</code> and{' '}
              <code className={code}>collected connect canvas --token</code> with a Canvas access token (Account → Settings → + New Access Token). Or paste the token under <Link to="/settings/sources" className="font-medium text-ink underline decoration-line-strong underline-offset-[3px] hover:decoration-brand">Sources</Link>.
            </div>
          </div>
        </li>
        <li className="flex items-start gap-3.5">
          {step(2, false)}
          <div>
            <div className="font-semibold">Pick your courses</div>
            <div className="mt-1 text-sub">Import them from your Canvas enrollments, or add them by hand.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/settings/courses?import=1">Import from Canvas</Link>
              </Button>
              <Button asChild variant="outline">
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
