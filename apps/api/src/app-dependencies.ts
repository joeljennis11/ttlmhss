import type { AppConfig } from './config/config.js';
import type { AccessPolicy, Authenticator } from './core/auth/access.js';
import type { Clock } from './core/utils/clock.js';
import type { DataStore } from './data/data-store.js';

/** Everything the application needs from the outside world. Tests substitute any part of it. */
export interface AppDependencies {
  config: AppConfig;
  dataStore: DataStore;
  clock: Clock;
  authenticator: Authenticator;
  accessPolicy: AccessPolicy;
}
