import { afterEach, describe, expect, it, vi } from 'vitest';

import { installEditorEntryHistoryLayoutSync } from '../../src/routing/editorEntryHistory';
import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from '../../src/stores/dockStore';

describe('editor entry history layout sync', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('restores Chat when browser history returns from the editor to /chat', () => {
    const loadSavedLayout = vi.fn();
    const dispose = installEditorEntryHistoryLayoutSync(loadSavedLayout);
    window.history.replaceState(null, '', '/chat');

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(loadSavedLayout).toHaveBeenCalledWith(FACTORY_START_LAYOUT_ID);
    dispose();
  });

  it('restores Video Edit for an /editor history entry and ignores unrelated routes', () => {
    const loadSavedLayout = vi.fn();
    const dispose = installEditorEntryHistoryLayoutSync(loadSavedLayout);
    window.history.replaceState(null, '', '/editor');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.history.replaceState(null, '', '/landing');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(loadSavedLayout).toHaveBeenCalledTimes(1);
    expect(loadSavedLayout).toHaveBeenCalledWith(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    dispose();
  });

  it('restores Medium for a /medium history entry', () => {
    const loadSavedLayout = vi.fn();
    const dispose = installEditorEntryHistoryLayoutSync(loadSavedLayout);
    window.history.replaceState(null, '', '/medium');

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(loadSavedLayout).toHaveBeenCalledWith(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
    dispose();
  });
});
