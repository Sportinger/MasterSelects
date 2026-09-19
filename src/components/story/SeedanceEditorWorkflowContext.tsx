import {
  useCallback,
  type PropsWithChildren,
} from 'react';

import {
  startLandingBackgroundJob,
  stopLandingBackgroundJob,
} from '../../marketing/landingBackgroundJob';
import { useSeedancePreproductionController } from '../../marketing/useSeedancePreproductionController';
import { SeedanceEditorWorkflowContext } from './seedanceEditorWorkflowState';

interface SeedanceEditorWorkflowProviderProps extends PropsWithChildren {
  enabled: boolean;
}

export function SeedanceEditorWorkflowProvider({
  children,
  enabled,
}: SeedanceEditorWorkflowProviderProps) {
  const executeDirectEdit = useCallback<Parameters<typeof useSeedancePreproductionController>[0]['executeDirectEdit']>(
    async ({ idempotencyKey, prompt, runId, sourceFileIds }) => {
      await startLandingBackgroundJob(prompt, undefined, {
        idempotencyKey,
        preproductionRunId: runId,
        sourceFileIds,
      });
    },
    [],
  );
  const workflow = useSeedancePreproductionController({
    enabled,
    executeDirectEdit,
    stopDirectEdit: stopLandingBackgroundJob,
  });

  return (
    <SeedanceEditorWorkflowContext.Provider value={workflow}>
      {children}
    </SeedanceEditorWorkflowContext.Provider>
  );
}
