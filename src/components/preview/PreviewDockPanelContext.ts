import { createContext, useContext } from 'react';

export const PreviewDockPanelContext = createContext<string | null>(null);

export function usePreviewDockPanelId(): string | null {
  return useContext(PreviewDockPanelContext);
}
