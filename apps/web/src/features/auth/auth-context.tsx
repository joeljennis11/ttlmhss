import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthSessionResponseSchema,
  ErrorCode,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
  type Permission,
} from '@ttlmhss/shared';
import { ApiClientError, apiRequest } from '../../lib/api-client';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'error'; message: string };

interface AuthContextValue {
  state: AuthState;
  login(input: LoginRequest): Promise<void>;
  logout(): Promise<void>;
  changePassword(input: ChangePasswordRequest): Promise<void>;
  /** UI convenience only — the API enforces every permission itself. */
  can(permission: Permission): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds who is signed in. The session lives in an HttpOnly cookie the browser sends
 * automatically; this code never sees or stores a token. On load it asks the API (/auth/me).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/auth/me', { schema: AuthSessionResponseSchema, signal: controller.signal })
      .then(({ user }) => setState({ status: 'signedIn', user }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiClientError && error.code === ErrorCode.UNAUTHORIZED) {
          setState({ status: 'signedOut' });
        } else {
          setState({
            status: 'error',
            message: error instanceof ApiClientError ? error.message : 'Something went wrong.',
          });
        }
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const { user } = await apiRequest('/auth/login', {
      method: 'POST',
      body: input,
      schema: AuthSessionResponseSchema,
    });
    setState({ status: 'signedIn', user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setState({ status: 'signedOut' });
    }
  }, []);

  const changePassword = useCallback(async (input: ChangePasswordRequest) => {
    const { user } = await apiRequest('/auth/change-password', {
      method: 'POST',
      body: input,
      schema: AuthSessionResponseSchema,
    });
    setState({ status: 'signedIn', user });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      logout,
      changePassword,
      can: (permission) =>
        state.status === 'signedIn' && state.user.permissions.includes(permission),
    }),
    [state, login, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
