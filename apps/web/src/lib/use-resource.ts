import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from './api-client';

export type Resource<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'error'; data?: undefined; error: string }
  | { status: 'ready'; data: T; error?: undefined };

interface Stored<T> {
  key: string;
  status: 'ready' | 'error';
  data?: T;
  error?: string;
}

export function messageOf(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : 'Something went wrong. Please try again.';
}

/**
 * Load data from the API for the current `key` (pass null to wait). Re-runs when the key changes;
 * `reload()` fetches again while keeping the current data on screen; `replace()` swaps in fresh
 * data an API call already returned (no extra request).
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> & { reload: () => void; replace: (data: T) => void } {
  const [stored, setStored] = useState<Stored<T> | null>(null);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    loadRef.current(controller.signal).then(
      (data) => setStored({ key, status: 'ready', data }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setStored({ key, status: 'error', error: messageOf(error) });
      },
    );
    return () => controller.abort();
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const replace = useCallback(
    (data: T) => {
      if (key !== null) setStored({ key, status: 'ready', data });
    },
    [key],
  );

  let resource: Resource<T>;
  if (!stored || stored.key !== key) resource = { status: 'loading' };
  else if (stored.status === 'error') resource = { status: 'error', error: stored.error ?? '' };
  else resource = { status: 'ready', data: stored.data as T };
  return { ...resource, reload, replace };
}
