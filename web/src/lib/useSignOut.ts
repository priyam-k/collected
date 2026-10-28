import { useEffect } from 'react';
import { toast } from 'sonner';
import { useLogout, useMe } from '@/lib/queries';

const FLAG = 'collected.signedOut';

/**
 * Signs out and lands on the home page. Behind Cloudflare Access the Access cookie would sign the person straight
 * back in, so that one leaves through Access's own logout instead. Used by the profile menu and Settings → Account.
 *
 * Leaving is a full page load of "/", not a client-side navigate: in-app, the router re-renders before the query
 * cache tells the page the session is gone, so "/" kept showing the board (whose next fetch then failed with 401)
 * or the settings gate bounced to /signin. A fresh load also drops every bit of the account's data held in memory.
 * The "Signed out" toast rides across the reload in sessionStorage (useSignedOutToast).
 */
export function useSignOut(): { signOut(): void; pending: boolean; available: boolean } {
  const me = useMe();
  const logout = useLogout();
  const access = !!me.data?.signIn.access;
  return {
    available: !!me.data && !me.data.authDisabled && !!me.data.user,
    pending: logout.isPending,
    signOut: () =>
      void logout.mutateAsync().then(
        () => {
          if (access) return window.location.assign('/cdn-cgi/access/logout');
          try {
            sessionStorage.setItem(FLAG, '1');
          } catch {
            // storage blocked: sign out all the same, just without the toast
          }
          window.location.replace('/');
        },
        (e: Error) => toast.error(e.message),
      ),
  };
}

/** Mounted once at the app root: shows "Signed out" on the page load that follows a sign-out. */
export function useSignedOutToast(): void {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(FLAG) == null) return;
    } catch {
      return;
    }
    // A tick later: the Toaster is mounted after App (main.tsx) and only listens once its own effect has run. The flag
    // is cleared inside the tick, not before it: StrictMode (development) runs this effect twice, and clearing it
    // before the first timer is cancelled would leave the second run with nothing to show.
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem(FLAG);
      } catch {
        // storage blocked; the flag was never set then
      }
      toast.success('Signed out');
    }, 0);
    return () => clearTimeout(t);
  }, []);
}
