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

  // jsdom does not implement modal <dialog>; a minimal stand-in (open attribute only) lets tests
  // see dialog content. Focus trapping and inertness are covered by the browser e2e tests.
  const dialogProto = window.HTMLDialogElement?.prototype;
  if (dialogProto && !dialogProto.showModal) {
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
}
