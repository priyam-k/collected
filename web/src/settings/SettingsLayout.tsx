import { NavLink, Route, Routes, Navigate, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useLiquid } from '@/lib/liquid';
import { cn } from '@/lib/utils';
import { SourcesPage } from './SourcesPage';
import { CoursesPage } from './CoursesPage';
import { TodoSyncPage } from './TodoSyncPage';
import { JobsPage } from './JobsPage';
import { LayoutPage } from './LayoutPage';
import { DataPage } from './DataPage';
import { AccountPage } from './AccountPage';
import { AboutPage } from './AboutPage';

// Absolute paths on purpose: inside a `/settings/*` splat route, a relative `to` resolves against the current
// URL, so clicking tabs used to build /settings/sources/courses/todoist.
const NAV = [
  { to: 'sources', label: 'Sources' },
  { to: 'courses', label: 'Courses' },
  { to: 'todo', label: 'To-do sync' },
  { to: 'jobs', label: 'Jobs' },
  { to: 'layout', label: 'Layout' },
  { to: 'data', label: 'Export / import' },
  { to: 'account', label: 'Account' },
  { to: 'about', label: 'About' },
];

export function SettingsLayout() {
  // NavLink marks the current section with aria-current="page"; the thumb springs to it.
  const liquid = useLiquid<HTMLElement>();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8">
        <Link to="/" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[13px] font-medium text-sub shadow-[var(--shadow-card),inset_0_0_0_1px_var(--line)] transition-colors hover:bg-surface-hover hover:text-ink">
          <ArrowLeft className="size-4" strokeWidth={1.7} /> Dashboard
        </Link>
        <Logo size={15} className="mt-7" />
        <h1 className="mt-1.5 text-[38px] font-[620] leading-[1.05] tracking-[-0.03em] sm:text-[44px]">Settings</h1>
      </header>
      <div className="grid gap-6 md:grid-cols-[12rem_1fr] md:gap-8">
        <nav ref={liquid} className="relative flex gap-1 self-start overflow-x-auto rounded-[22px] p-1 [scrollbar-width:none] md:sticky md:top-6 md:flex-col md:bg-well">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={`/settings/${n.to}`}
              className={({ isActive }) =>
                cn('relative z-[1] whitespace-nowrap rounded-full px-4 py-2 text-[14px] transition-colors', isActive ? 'font-semibold text-ink' : 'text-sub hover:text-ink')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="surface min-w-0 p-5 sm:p-8">
          <Routes>
            <Route index element={<Navigate to="/settings/sources" replace />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="todo" element={<TodoSyncPage />} />
            <Route path="todoist" element={<Navigate to="/settings/todo" replace />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="layout" element={<LayoutPage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="about" element={<AboutPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
