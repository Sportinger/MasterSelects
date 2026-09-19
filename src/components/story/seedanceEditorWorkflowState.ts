import { createContext, useContext } from 'react';

import type { useSeedancePreproductionController } from '../../marketing/useSeedancePreproductionController';

export type SeedanceEditorWorkflow = ReturnType<typeof useSeedancePreproductionController>;

export const SeedanceEditorWorkflowContext = createContext<SeedanceEditorWorkflow | null>(null);

export function useSeedanceEditorWorkflow(): SeedanceEditorWorkflow {
  const workflow = useContext(SeedanceEditorWorkflowContext);
  if (!workflow) {
    throw new Error('Story workflow is unavailable outside the dock workspace.');
  }
  return workflow;
}
