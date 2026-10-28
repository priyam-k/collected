import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { isSignedIn, useMe } from '@/lib/queries';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignInPage } from '@/pages/SignInPage';
import { DemoPage, Landing, Privacy, Terms } from '@/pages/public';
import { PaneProvider } from '@/panes/PaneContext';

function ServerDown() {
  return <main className="flex min-h-dvh items-center justify-center px-4 text-[13px] text-sub">The server is not answering. Check that it is running, then reload.</main>;
}

/** Everything behind this needs a signed-in person; the API would answer 401 anyway, this just routes the user. */
function Gate({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return null;
  if (me.isError) return <ServerDown />;
  if (!isSignedIn(me.data)) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** The root is the board for a person and the landing page for a visitor. */
function Home() {
  const me = useMe();
  if (me.isPending) return null;
  if (me.isError) return <ServerDown />;
  return isSignedIn(me.data) ? <DashboardPage /> : <Landing />;
}

export default function App() {
  return (
    <PaneProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route
          path="/settings/*"
          element={
            <Gate>
              <SettingsPage />
            </Gate>
          }
        />
      </Routes>
    </PaneProvider>
  );
}
