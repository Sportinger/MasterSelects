import type { ShortcutActionId } from '../../../../services/shortcutTypes';
import type { MaskProperty } from "../../../../types/animationProperties";
import type { ClipMask, MaskVertexHandleMode } from "../../../../types/masks";
import { IconButton } from './IconButton';
import { MaskEdgeSection } from './MaskEdgeSection';
import { MaskModeSegmented } from './MaskModeSegmented';
import { MaskVertexTools } from './MaskVertexTools';

interface MaskActiveCardShortcutRegistry {
  getLabel: (command: ShortcutActionId) => string;
}

interface MaskActiveCardProps {
  activeMask: ClipMask;
  clipId: string;
  registry: MaskActiveCardShortcutRegistry;
  selectedHandleMode: MaskVertexHandleMode | 'mixed' | null;
  selectedMaskEdgeId: string | null;
  selectedVertexDisplayCount: number;
  selectedVertexCount: number;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onCycleSelectedHandles: () => void;
  onSetSelectedHandles: (mode: MaskVertexHandleMode) => void;
  closeMask: (clipId: string, maskId: string) => void;
  showMaskFeatherPreview: (maskId: string, edgeId?: string | null) => void;
  setPropertyValue: (clipId: string, property: MaskProperty, value: number) => void;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
}

export function MaskActiveCard({
  activeMask,
  clipId,
  closeMask,
  onBatchEnd,
  onBatchStart,
  onCycleSelectedHandles,
  onSetSelectedHandles,
  registry,
  selectedHandleMode,
  selectedMaskEdgeId,
  selectedVertexDisplayCount,
  selectedVertexCount,
  showMaskFeatherPreview,
  setPropertyValue,
  updateMask,
}: MaskActiveCardProps) {
  return (
    <div className="mask-active-card">
      <div className="mask-active-header">
        <div>
          <strong>{activeMask.name}</strong>
          <span>
            {activeMask.closed ? 'Closed path' : 'Open path'} / {activeMask.vertices.length} vertices / {selectedVertexDisplayCount} selected
          </span>
        </div>
        <div className="mask-active-actions">
          <IconButton
            icon="power"
            title={activeMask.enabled === false ? 'Enable render' : 'Disable render'}
            active={activeMask.enabled !== false}
            onClick={() => updateMask(clipId, activeMask.id, { enabled: activeMask.enabled === false })}
          />
          <IconButton
            icon={activeMask.visible ? 'eye' : 'eyeOff'}
            title="Toggle outline"
            active={activeMask.visible}
            onClick={() => updateMask(clipId, activeMask.id, { visible: !activeMask.visible })}
          />
          <IconButton
            icon="invert"
            title={`Invert (${registry.getLabel('mask.invert')})`}
            active={activeMask.inverted}
            onClick={() => updateMask(clipId, activeMask.id, { inverted: !activeMask.inverted })}
          />
          <IconButton
            icon="close"
            title={`Close Path (${registry.getLabel('mask.closePath')})`}
            disabled={activeMask.closed || activeMask.vertices.length < 3}
            onClick={() => closeMask(clipId, activeMask.id)}
          />
        </div>
      </div>

      <MaskVertexTools
        registry={registry}
        selectedHandleMode={selectedHandleMode}
        selectedVertexCount={selectedVertexCount}
        onCycleSelectedHandles={onCycleSelectedHandles}
        onSetSelectedHandles={onSetSelectedHandles}
      />

      <MaskModeSegmented activeMask={activeMask} clipId={clipId} updateMask={updateMask} />

      <MaskEdgeSection
        activeMask={activeMask}
        clipId={clipId}
        onBatchEnd={onBatchEnd}
        onBatchStart={onBatchStart}
        selectedMaskEdgeId={selectedMaskEdgeId}
        showMaskFeatherPreview={showMaskFeatherPreview}
        setPropertyValue={setPropertyValue}
      />
    </div>
  );
}
