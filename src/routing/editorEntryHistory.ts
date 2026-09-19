import { isChatPath, isEditorPath, isMediumPath } from './entryExperience';
import { resolveInitialDockLayoutId, type EditorEntryExperience } from './entryDockLayout';

export function installEditorEntryHistoryLayoutSync(
  loadSavedLayout: (layoutId: string) => void,
): () => void {
  const restoreEntryLayoutOnBack = () => {
    const nextExperience: EditorEntryExperience | null = isChatPath(window.location.pathname)
      ? 'chat'
      : isEditorPath(window.location.pathname)
        ? 'editor'
        : isMediumPath(window.location.pathname)
          ? 'medium'
          : null;
    if (!nextExperience) return;
    const nextLayoutId = resolveInitialDockLayoutId(nextExperience);
    if (nextLayoutId) loadSavedLayout(nextLayoutId);
  };

  window.addEventListener('popstate', restoreEntryLayoutOnBack);
  return () => window.removeEventListener('popstate', restoreEntryLayoutOnBack);
}
