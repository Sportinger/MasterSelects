import { flushSync } from 'react-dom';

export function runFlashBoardReferenceTransition(update: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    update();
    return;
  }

  if (
    !('startViewTransition' in document)
    || typeof document.startViewTransition !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }

  document.documentElement.classList.add('fb-reference-view-transition');
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  void transition.finished.finally(() => {
    document.documentElement.classList.remove('fb-reference-view-transition');
  });
}
