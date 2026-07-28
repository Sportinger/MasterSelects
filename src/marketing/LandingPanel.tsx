import { useCallback, useEffect, useState } from 'react';

import {
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  START_CHAT_EXIT_DURATION_MS,
  START_EDITOR_REVEAL_DURATION_MS,
  useDockStore,
} from '../stores/dockStore';
import { LandingPage } from './LandingPage';

export function LandingPanel() {
  const loadSavedLayout = useDockStore((state) => state.loadSavedLayout);
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);

  const openEditor = useCallback(() => {
    setIsOpeningEditor(true);
  }, []);

  useEffect(() => {
    if (!isOpeningEditor) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timeoutId = window.setTimeout(() => {
      if (window.location.pathname === '/landing') {
        window.history.replaceState(window.history.state, '', '/');
      }

      loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
        transitionDurationMs: reduceMotion ? 0 : START_EDITOR_REVEAL_DURATION_MS,
        transitionStaggerMode: 'sequence',
      });
    }, reduceMotion ? 0 : START_CHAT_EXIT_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpeningEditor, loadSavedLayout]);

  return (
    <LandingPage
      isOpeningEditor={isOpeningEditor}
      onOpenEditor={openEditor}
    />
  );
}
