import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLogout, useMe } from '@/lib/queries';

/**
 * Signs out and lands on the home page. Behind Cloudflare Access the Access cookie would sign the person straight
 * back in, so that one leaves through Access's own logout instead. Used by the profile menu and Settings → Account.
 */
export function useSignOut(): { signOut(): void; pending: boolean; available: boolean } {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const access = !!me.data?.signIn.access;
  return {
    available: !!me.data && !me.data.authDisabled && !!me.data.user,
    pending: logout.isPending,
    signOut: () =>
      logout.mutate(undefined, {
        onSuccess: () => {
          if (access) window.location.assign('/cdn-cgi/access/logout');
          else {
            navigate('/', { replace: true });
            toast.success('Signed out');
          }
        },
        onError: (e) => toast.error(e.message),
      }),
  };
}
