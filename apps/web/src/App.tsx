import { FoundationStatus } from './features/foundation/FoundationStatus';

/**
 * Application root. Routing, the authenticated shell and the login page arrive in Phases 2–3.
 */
export function App() {
  return <FoundationStatus />;
}
