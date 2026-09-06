import { NavLink, Route, Routes, Navigate, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourcesPage } from './SourcesPage';
import { CoursesPage } from './CoursesPage';
import { TodoistPage } from './TodoistPage';
import { JobsPage } from './JobsPage';
import { LayoutPage } from './LayoutPage';
import { DataPage } from './DataPage';

const NAV = [
  { to: 'sources', label: 'Sources' },
  { to: 'courses', label: 'Courses' },
  { to: 'todoist', label: 'Todoist sync' },
  { to: 'jobs', label: 'Jobs' },
  { to: 'layout', label: 'Layout' },
  { to: 'data', label: 'Export / import' },
];

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl px-3 pb-12 pt-3 sm:px-4">
      <header className="mb-4 flex items-center gap-3">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <h1 className="text-base font-semibold tracking-tight">Settings</h1>
      </header>
      <div className="grid gap-6 md:grid-cols-[11rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-secondary/60')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="sources" replace />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="todoist" element={<TodoistPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="layout" element={<LayoutPage />} />
            <Route path="data" element={<DataPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
