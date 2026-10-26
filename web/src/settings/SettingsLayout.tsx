import { NavLink, Route, Routes, Navigate, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourcesPage } from './SourcesPage';
import { CoursesPage } from './CoursesPage';
import { TodoistPage } from './TodoistPage';
import { JobsPage } from './JobsPage';
import { LayoutPage } from './LayoutPage';
import { DataPage } from './DataPage';
import { AccountPage } from './AccountPage';

// Absolute paths on purpose: inside a `/settings/*` splat route, a relative `to` resolves against the current
// URL, so clicking tabs used to build /settings/sources/courses/todoist.
const NAV = [
  { to: 'sources', label: 'Sources' },
  { to: 'courses', label: 'Courses' },
  { to: 'todoist', label: 'Todoist sync' },
  { to: 'jobs', label: 'Jobs' },
  { to: 'layout', label: 'Layout' },
  { to: 'data', label: 'Export / import' },
  { to: 'account', label: 'Account' },
];

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl px-3 pb-12 pt-3 sm:px-4">
      <header className="mb-4 flex items-center gap-3">
        <Link to="/" className="inline-flex h-8 items-center gap-1 rounded-full border border-line2 bg-card px-3 text-[13px] text-sub shadow-[var(--shadow)] transition-colors hover:bg-well hover:text-ink">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.03em]">Settings</h1>
      </header>
      <div className="grid gap-6 md:grid-cols-[11rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={`/settings/${n.to}`}
              className={({ isActive }) =>
                cn('whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors', isActive ? 'bg-well2 font-semibold text-ink' : 'text-sub hover:bg-well hover:text-ink')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="/settings/sources" replace />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="todoist" element={<TodoistPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="layout" element={<LayoutPage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="account" element={<AccountPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
