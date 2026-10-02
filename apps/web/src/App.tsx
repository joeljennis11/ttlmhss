import { AuthProvider } from './features/auth/auth-context';
import { AuthGate } from './features/auth/AuthGate';

/**
 * Application root. The application shell (navigation, layout, final branding) arrives in Phase 3.
 */
export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
