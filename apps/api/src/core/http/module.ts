import type { AnyRouteDefinition } from './routes.js';

/**
 * A feature module contributes routes under /api/v1. Each feature (later phases) lives in
 * src/modules/<feature>/ with:
 *   <feature>.module.ts   – builds services from dependencies and lists routes
 *   <feature>.service.ts  – business rules (no HTTP, no database client)
 *   <feature>.policy.ts   – record-level authorization (from Phase 2)
 *   <feature>.repository.ts – repository INTERFACE; implementation lives in src/data/kysely
 *   <feature>.schemas.ts  – request schemas (or in @ttlmhss/shared when the web app needs them)
 */
export interface FeatureModule {
  readonly name: string;
  readonly routes: readonly AnyRouteDefinition[];
}
