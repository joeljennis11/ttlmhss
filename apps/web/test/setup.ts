import { afterEach, vi } from 'vitest';

// Only for DOM (jsdom) test files.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  // jsdom lacks matchMedia; tests run at "desktop" width unless they override it.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
}
