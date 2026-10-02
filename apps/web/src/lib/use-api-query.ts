import { useEffect, useState } from 'react';
import { ApiClientError } from './api-client';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiClientError };

const LOADING = { status: 'loading' } as const;

/**
 * Minimal request hook with loading / success / error states and cancellation.
 * State is stored together with the key it belongs to, so a new key is "loading" until its own
 * result arrives (no synchronous state reset inside the effect).
 */
export function useApiQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): AsyncState<T> {
  const [result, setResult] = useState<{ key: string; state: AsyncState<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, state: { status: 'success', data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          state: {
            status: 'error',
            error:
              error instanceof ApiClientError
                ? error
                : new ApiClientError('UNKNOWN', 'Something went wrong. Please try again.', 0),
          },
        });
      });
    return () => controller.abort();
    // `key` identifies the request; `load` is recreated on every render by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result?.key === key ? result.state : LOADING;
}
