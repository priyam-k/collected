import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { isSignedIn, useMe } from '@/lib/queries';
import { DASHBOARD } from '@/lib/routes';
import { useSignedOutToast } from '@/lib/useSignOut';
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

/**
 * "/" is always the public home page, signed in or not; the board has its own address (lib/routes.ts). One page per
 * address keeps a sign-in or sign-out from having to swap the page under the same URL.
 */
export default function App() {
  useSignedOutToast();
  return (
    <PaneProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path={DASHBOARD}
          element={
            <Gate>
              <DashboardPage />
            </Gate>
          }
        />
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
        {/* Anything else goes to the home page rather than rendering a blank one. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PaneProvider>
  );
}
