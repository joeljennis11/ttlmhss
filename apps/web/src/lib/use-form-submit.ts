import { useCallback, useState } from 'react';
import type { z } from 'zod';
import { ApiClientError } from './api-client';
import { messageOf } from './use-resource';

/** Field path (without the "body." prefix, e.g. "name" or "bands.2.minPercent") → messages. */
export type FieldErrors = Record<string, string[]>;

/**
 * Runs a save against the API and turns its answer into form feedback:
 * field-level issues go next to their fields, anything else becomes one banner message.
 * `fields` lists the field paths the form shows, so no message is ever silently lost.
 */
export function useFormSubmit(fields: readonly string[] | ((path: string) => boolean)) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setErrors({});
    setFormError(null);
  }, []);

  const shows = typeof fields === 'function' ? fields : (path: string) => fields.includes(path);

  async function run<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      if (error instanceof ApiClientError && error.details.length > 0) {
        const byField: FieldErrors = {};
        const other: string[] = [];
        for (const issue of error.details) {
          const path = issue.path.replace(/^(body|params|query)\.?/, '');
          if (path && shows(path)) (byField[path] ??= []).push(issue.message);
          else other.push(issue.message);
        }
        setErrors(byField);
        setFormError(other.length ? other.join(' ') : null);
      } else {
        setFormError(messageOf(error));
      }
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  /**
   * Check the values with the same shared schema the API uses, so obvious mistakes are shown
   * before sending. Returns the parsed value, or null after showing the problems.
   */
  function check<S extends z.ZodType>(schema: S, value: unknown): z.output<S> | null {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const byField: FieldErrors = {};
    const other: string[] = [];
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && shows(path)) (byField[path] ??= []).push(issue.message);
      else other.push(issue.message);
    }
    setErrors(byField);
    setFormError(other.length ? [...new Set(other)].join(' ') : null);
    return null;
  }

  return { pending, errors, formError, run, check, reset, setFormError };
}
