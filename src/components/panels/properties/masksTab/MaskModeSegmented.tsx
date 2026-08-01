import type { ClipMask } from "../../../../types/masks";
import { MASK_MODES } from './maskTabConstants';

interface MaskModeSegmentedProps {
  activeMask: ClipMask;
  clipId: string;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
}

export function MaskModeSegmented({ activeMask, clipId, updateMask }: MaskModeSegmentedProps) {
  return (
    <div className="mask-mode-segmented" role="group" aria-label="Mask mode">
      {MASK_MODES.map(mode => (
        <button
          key={mode.value}
          type="button"
          className={activeMask.mode === mode.value ? 'active' : ''}
          aria-pressed={activeMask.mode === mode.value}
          onClick={() => updateMask(clipId, activeMask.id, { mode: mode.value })}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
