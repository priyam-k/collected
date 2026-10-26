import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { isSignedIn, useMe } from '@/lib/queries';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignInPage } from '@/pages/SignInPage';
import { PaneProvider } from '@/panes/PaneContext';

/** Everything behind this needs a signed-in person; the API would answer 401 anyway, this just routes the user. */
function Gate({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return null;
  if (me.isError) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 text-[13px] text-sub">
        The server is not answering. Check that it is running, then reload.
      </main>
    );
  }
  if (!isSignedIn(me.data)) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <PaneProvider>
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route
          path="/"
          element={
            <Gate>
              <DashboardPage />
            </Gate>
          }
        />
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
