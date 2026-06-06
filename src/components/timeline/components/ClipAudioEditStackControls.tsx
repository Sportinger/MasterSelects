import { memo } from 'react';
import type { ClipAudioEditOperation } from '../../../types';

interface ClipAudioEditStackControlsProps {
  operations: readonly ClipAudioEditOperation[];
  activeCount: number;
  audioBakePending: boolean;
  canUnbakeAudioEditStack: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onToggleOperation: (operationId: string, disabled: boolean) => void;
  onRemoveOperation: (operationId: string) => void;
  onBake: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onUnbake: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClear: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const ClipAudioEditStackControls = memo(function ClipAudioEditStackControls({
  operations,
  activeCount,
  audioBakePending,
  canUnbakeAudioEditStack,
  onMouseDown,
  onToggleOperation,
  onRemoveOperation,
  onBake,
  onUnbake,
  onClear,
}: ClipAudioEditStackControlsProps) {
  return (
    <div className="clip-audio-edit-stack" onMouseDown={onMouseDown}>
      <span className="clip-audio-edit-stack-count" title={`${activeCount} active audio edits`}>
        {activeCount}/{operations.length}
      </span>
      {operations.map(operation => (
        <button
          type="button"
          key={operation.id}
          className={operation.enabled === false ? 'disabled' : ''}
          title={`${operation.params.label ?? operation.type}: click to ${operation.enabled === false ? 'enable' : 'bypass'}, Alt-click to remove`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.altKey) {
              onRemoveOperation(operation.id);
              return;
            }
            onToggleOperation(operation.id, operation.enabled === false);
          }}
        >
          {String(operation.params.label ?? operation.type).slice(0, 3)}
        </button>
      ))}
      <button type="button" onClick={onBake} disabled={audioBakePending || activeCount === 0} title="Bake active audio edits into a new WAV source">
        {audioBakePending ? '...' : 'Bake'}
      </button>
      <button type="button" onClick={onUnbake} disabled={audioBakePending || !canUnbakeAudioEditStack} title="Restore the source audio and region edits from the latest bake">
        Unbake
      </button>
      <button type="button" onClick={onClear} title="Clear audio edit stack">
        Clear
      </button>
    </div>
  );
});
