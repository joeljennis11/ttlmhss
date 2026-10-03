import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SchoolBrandingSchema, type SchoolBranding } from '@ttlmhss/shared';
import { apiRequest } from '../lib/api-client';
import { DEFAULT_BRANDING } from './brand';

interface BrandingContextValue {
  branding: SchoolBranding;
  /** Fetch the identity again (after an administrator edits the school details). */
  refresh(): void;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULT_BRANDING,
  refresh: () => undefined,
});

/** Loads the school identity for the whole app (once per page load, and after Admin edits). */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<SchoolBranding>(DEFAULT_BRANDING);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/school/branding', { schema: SchoolBrandingSchema, signal: controller.signal })
      .then((loaded) =>
        setBranding({ ...loaded, logoUrl: loaded.logoUrl ?? DEFAULT_BRANDING.logoUrl }),
      )
      .catch(() => {
        // Keep the current values: the identity is still correct, only Admin edits would be missing.
      });
    return () => controller.abort();
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ branding, refresh }), [branding, refresh]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): SchoolBranding {
  return useContext(BrandingContext).branding;
}

export function useRefreshBranding(): () => void {
  return useContext(BrandingContext).refresh;
}
