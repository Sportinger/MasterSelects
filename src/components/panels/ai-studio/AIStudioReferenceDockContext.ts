import { createContext, useContext, type ReactNode } from 'react';

export const AIStudioReferenceDockContext = createContext<ReactNode>(null);

export function useAIStudioReferenceDock(): ReactNode {
  return useContext(AIStudioReferenceDockContext);
}
