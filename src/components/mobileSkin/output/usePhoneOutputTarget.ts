import { useEffect, useMemo } from 'react';

import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import type { RenderTarget } from '../../../types/renderTarget';
import { listOutputTargets } from '../../outputManager/outputTargetCommands';
import { usePhoneOutputStore } from './phoneOutputStore';

/** The output targets, and the selected one (the first target when nothing valid is selected). */
export function usePhoneOutputTargets(): { targets: RenderTarget[]; selected: RenderTarget | null } {
  const map = useRenderTargetStore((state) => state.targets);
  const selectedId = usePhoneOutputStore((state) => state.selectedTargetId);
  const selectTarget = usePhoneOutputStore((state) => state.selectTarget);
  const targets = useMemo(() => listOutputTargets(map), [map]);
  const selected = targets.find((target) => target.id === selectedId) ?? targets[0] ?? null;
  useEffect(() => {
    if ((selected?.id ?? null) !== selectedId) selectTarget(selected?.id ?? null);
  }, [selected, selectedId, selectTarget]);
  return { targets, selected };
}
