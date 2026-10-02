import { Route, Routes } from 'react-router';
import { AppShell } from '../shell/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { ForcedPasswordChangePage } from '../features/auth/ForcedPasswordChangePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PublicOnly, RequireAuth, RequirePasswordChange, RequirePermission } from './guards';
import { SHELL_ROUTES, type ShellRoute } from './routes';

/**
 *   /login            sign-in (signed-in users are redirected away)
 *   /change-password  mandatory change of a temporary password (outside the shell)
 *   /…                every other page, inside the authenticated shell
 *   anything else     "page not found" inside the shell
 */
export function AppRoutes({ routes = SHELL_ROUTES }: { routes?: readonly ShellRoute[] }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/change-password"
        element={
          <RequirePasswordChange>
            <ForcedPasswordChangePage />
          </RequirePasswordChange>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell routes={routes} />
          </RequireAuth>
        }
      >
        {routes.map((route) => {
          const element = (
            <RequirePermission
              {...(route.permission ? { permission: route.permission } : {})}
              {...(route.roles ? { roles: route.roles } : {})}
            >
              {route.element}
            </RequirePermission>
          );
          return route.path === '' ? (
            <Route key="index" index element={element} />
          ) : (
            <Route key={route.path} path={route.path} element={element} />
          );
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
