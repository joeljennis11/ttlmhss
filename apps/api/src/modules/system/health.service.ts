import type { HealthResponse } from '@ttlmhss/shared';
import type { Clock } from '../../core/utils/clock.js';

export interface HealthServiceDeps {
  pingDatabase(): Promise<boolean>;
  clock: Clock;
}

export class HealthService {
  constructor(private readonly deps: HealthServiceDeps) {}

  async check(): Promise<HealthResponse> {
    const databaseUp = await this.deps.pingDatabase();
    return {
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
      time: this.deps.clock.now().toISOString(),
    };
  }
}
