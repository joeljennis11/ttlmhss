import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SchoolBrandingSchema, type SchoolBranding } from '@ttlmhss/shared';
import { apiRequest } from '../lib/api-client';
import { DEFAULT_BRANDING } from './brand';

const BrandingContext = createContext<SchoolBranding>(DEFAULT_BRANDING);

/** Loads the school identity once for the whole app (one request per page load). */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<SchoolBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/school/branding', { schema: SchoolBrandingSchema, signal: controller.signal })
      .then((loaded) =>
        setBranding({ ...loaded, logoUrl: loaded.logoUrl ?? DEFAULT_BRANDING.logoUrl }),
      )
      .catch(() => {
        // Keep the defaults: the identity is still correct, only Admin edits would be missing.
      });
    return () => controller.abort();
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): SchoolBranding {
  return useContext(BrandingContext);
}
