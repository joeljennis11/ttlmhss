import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { EffectiveRole, Permission } from '@ttlmhss/shared';
import { ErrorState, LoadingState } from '../components/ui';
import { useAuth } from '../features/auth/auth-context';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { canAccessRoute } from '../shell/navigation';

/*
 * Route guards. They decide what to RENDER; they are not the security boundary — every protected
 * API refuses unauthenticated or unauthorised calls on its own (Phase 2).
 */

interface FromState {
  from?: { pathname: string; search?: string };
}

function SessionError() {
  const { state, refresh } = useAuth();
  return (
    <main>
      <ErrorState
        title="TTLMHSS could not start"
        message={state.status === 'error' ? state.message : undefined}
        onRetry={() => void refresh()}
      />
    </main>
  );
}

/** Pages inside the app: signed in, with a password the user chose. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <LoadingState fullPage label="Checking your sign-in…" />;
  if (state.status === 'error') return <SessionError />;
  if (state.status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location } satisfies FromState} />;
  }
  if (state.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
}

/** The sign-in page: signed-in users are sent on to where they were going. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <LoadingState fullPage label="Checking your sign-in…" />;
  if (state.status === 'signedIn') {
    if (state.user.mustChangePassword) return <Navigate to="/change-password" replace />;
    const from = (location.state as FromState | null)?.from;
    const target =
      from && from.pathname.startsWith('/') && from.pathname !== '/login'
        ? `${from.pathname}${from.search ?? ''}`
        : '/';
    return <Navigate to={target} replace />;
  }
  return children;
}

/** The mandatory first-sign-in password change. */
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <LoadingState fullPage label="Checking your sign-in…" />;
  if (state.status === 'error') return <SessionError />;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  if (!state.user.mustChangePassword) return <Navigate to="/" replace />;
  return children;
}

/** Shows the "no access" page instead of the content when the user lacks the permission/role. */
export function RequirePermission({
  permission,
  roles,
  children,
}: {
  permission?: Permission;
  roles?: readonly EffectiveRole[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  if (
    !canAccessRoute(user, { ...(permission ? { permission } : {}), ...(roles ? { roles } : {}) })
  ) {
    return <ForbiddenPage />;
  }
  return children;
}
