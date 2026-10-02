import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthSessionResponseSchema,
  ErrorCode,
  type AuthUser,
  type ChangePasswordRequest,
  type EffectiveRole,
  type LoginRequest,
  type Permission,
} from '@ttlmhss/shared';
import { ApiClientError, apiRequest, onAuthFailure } from '../../lib/api-client';

/** Why the user is signed out — shown on the sign-in page. */
export type SignedOutReason = 'initial' | 'signedOut' | 'expired';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason: SignedOutReason }
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'error'; message: string };

interface AuthContextValue {
  state: AuthState;
  /** The signed-in user, or null. */
  user: AuthUser | null;
  login(input: LoginRequest): Promise<AuthUser>;
  logout(): Promise<void>;
  changePassword(input: ChangePasswordRequest): Promise<AuthUser>;
  /** Re-read the session from the API (e.g. after an error page "Try again"). */
  refresh(): Promise<void>;
  /** UI convenience only — the API enforces every permission itself. */
  can(permission: Permission): boolean;
  hasRole(role: EffectiveRole): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Ask the API who is signed in. Returns the resulting state (null if the request was aborted).
 * Pure: callers decide when to apply it.
 */
async function fetchSession(signal?: AbortSignal): Promise<AuthState | null> {
  try {
    const { user } = await apiRequest('/auth/me', {
      schema: AuthSessionResponseSchema,
      ...(signal ? { signal } : {}),
    });
    return { status: 'signedIn', user };
  } catch (error) {
    if (signal?.aborted) return null;
    if (error instanceof ApiClientError && error.code === ErrorCode.UNAUTHORIZED) {
      return { status: 'signedOut', reason: 'initial' };
    }
    return {
      status: 'error',
      message:
        error instanceof ApiClientError ? error.message : 'Something went wrong. Please try again.',
    };
  }
}

/** Keep a more specific sign-out reason (e.g. "expired") instead of overwriting it with "initial". */
function mergeSignedOut(current: AuthState, next: AuthState): AuthState {
  return current.status === 'signedOut' && next.status === 'signedOut' ? current : next;
}

/** Re-check the session when the tab becomes visible again, at most this often. */
const REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Who is signed in. The session itself is an HttpOnly cookie the browser sends automatically;
 * this code never sees or stores a token, and keeps only the non-secret user summary in memory.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Latest state for event listeners registered once (kept in sync after each render).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const lastCheck = useRef(0);

  /** Re-read the session and apply it. Used from event handlers and listeners. */
  const load = useCallback(async () => {
    lastCheck.current = Date.now();
    const next = await fetchSession();
    if (next) setState((current) => mergeSignedOut(current, next));
  }, []);

  // Initial session check.
  useEffect(() => {
    const controller = new AbortController();
    lastCheck.current = Date.now();
    void fetchSession(controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setState((current) => mergeSignedOut(current, next));
    });
    return () => controller.abort();
  }, []);

  // Any API call that finds the session gone (expired, revoked, account deactivated) signs the
  // UI out; a temporary-password response re-reads the user so the change-password flow shows.
  useEffect(
    () =>
      onAuthFailure(({ code, path }) => {
        if (path === '/auth/login') return;
        if (code === ErrorCode.UNAUTHORIZED && stateRef.current.status === 'signedIn') {
          setState({ status: 'signedOut', reason: 'expired' });
        } else if (code === ErrorCode.PASSWORD_CHANGE_REQUIRED) {
          void load();
        }
      }),
    [load],
  );

  // Coming back to the tab after a while: confirm the session is still valid.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        stateRef.current.status === 'signedIn' &&
        Date.now() - lastCheck.current > REVALIDATE_INTERVAL_MS
      ) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const login = useCallback(async (input: LoginRequest) => {
    const { user } = await apiRequest('/auth/login', {
      method: 'POST',
      body: input,
      schema: AuthSessionResponseSchema,
    });
    lastCheck.current = Date.now();
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: {} });
    } finally {
      // Even if the request failed, forget the user locally; the server session expires anyway.
      setState({ status: 'signedOut', reason: 'signedOut' });
    }
  }, []);

  const changePassword = useCallback(async (input: ChangePasswordRequest) => {
    const { user } = await apiRequest('/auth/change-password', {
      method: 'POST',
      body: input,
      schema: AuthSessionResponseSchema,
    });
    setState({ status: 'signedIn', user });
    return user;
  }, []);

  const refresh = useCallback(() => load(), [load]);

  const value = useMemo<AuthContextValue>(() => {
    const user = state.status === 'signedIn' ? state.user : null;
    return {
      state,
      user,
      login,
      logout,
      changePassword,
      refresh,
      can: (permission) => user?.permissions.includes(permission) ?? false,
      hasRole: (role) => user?.roles.includes(role) ?? false,
    };
  }, [state, login, logout, changePassword, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
