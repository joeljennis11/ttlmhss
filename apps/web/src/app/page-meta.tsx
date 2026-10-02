import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useBranding } from '../brand/BrandingProvider';

interface PageMeta {
  title: string;
  setTitle(title: string): void;
}

const PageMetaContext = createContext<PageMeta | null>(null);

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('');
  return (
    <PageMetaContext.Provider value={{ title, setTitle }}>{children}</PageMetaContext.Provider>
  );
}

/** Sets the browser tab title and the header breadcrumb for the current page. */
export function usePageTitle(title: string): void {
  const context = useContext(PageMetaContext);
  const { shortName } = useBranding();
  const setTitle = context?.setTitle;
  useEffect(() => {
    document.title = title ? `${title} | ${shortName}` : shortName;
    setTitle?.(title);
  }, [title, shortName, setTitle]);
}

export function usePageMeta(): Pick<PageMeta, 'title'> {
  return { title: useContext(PageMetaContext)?.title ?? '' };
}
