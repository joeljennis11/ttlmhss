import { useEffect, useState } from 'react';
import { HealthResponseSchema } from '@ttlmhss/shared';
import { Alert } from '../../components/ui';
import { apiRequest } from '../../lib/api-client';

/**
 * Shown on the sign-in page ONLY when the system cannot work (API unreachable or database down),
 * so people know the problem is not their password. Silent when everything is fine.
 */
export function SystemNotice() {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/health', { schema: HealthResponseSchema, signal: controller.signal })
      .then((health) => {
        if (health.database !== 'up') {
          setProblem('The school system is having a problem right now. Please try again shortly.');
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setProblem('The school system cannot be reached right now. Check your connection.');
      });
    return () => controller.abort();
  }, []);

  return problem ? <Alert tone="warning">{problem}</Alert> : null;
}
