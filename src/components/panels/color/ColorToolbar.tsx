import { ListViewIcon, NodeViewIcon, SetAllKeyframesIcon } from './ColorEditorIcons';

interface ColorToolbarProps {
  renderedViewMode: 'list' | 'nodes';
  enabled: boolean;
  addNodeDisabled: boolean;
  maxRuntimePrimaryNodes: number;
  onSwitchViewMode: (viewMode: 'list' | 'nodes') => void;
  onToggleEnabled: () => void;
  onSetAllKeyframes: () => void;
  onAddPrimary: () => void;
  onAddWheels: () => void;
  onReset: () => void;
}

export function ColorToolbar({
  renderedViewMode,
  enabled,
  addNodeDisabled,
  maxRuntimePrimaryNodes,
  onSwitchViewMode,
  onToggleEnabled,
  onSetAllKeyframes,
  onAddPrimary,
  onAddWheels,
  onReset,
}: ColorToolbarProps) {
  const addDisabledTitle = `Realtime graph limit is ${maxRuntimePrimaryNodes} color nodes`;

  return (
    <div className="color-toolbar">
      <div className="color-view-segment" role="tablist" aria-label="Color view mode">
        <button
          type="button"
          className={`color-view-toggle ${renderedViewMode === 'list' ? 'active' : ''}`}
          onClick={() => onSwitchViewMode('list')}
          title="List view"
          aria-label="List view"
        >
          <ListViewIcon />
        </button>
        <button
          type="button"
          className={`color-view-toggle ${renderedViewMode === 'nodes' ? 'active' : ''}`}
          onClick={() => onSwitchViewMode('nodes')}
          title="Node view"
          aria-label="Node view"
        >
          <NodeViewIcon />
        </button>
      </div>

      <button
        className={!enabled ? 'color-toggle active' : 'color-toggle'}
        type="button"
        onClick={onToggleEnabled}
        title={enabled ? 'Bypass color correction' : 'Enable color correction'}
      >
        {enabled ? 'Bypass' : 'Bypassed'}
      </button>

      <button
        type="button"
        className="color-keyframe-all-button"
        onClick={onSetAllKeyframes}
        title="Enable all color stopwatches and set keyframes at the playhead"
        aria-label="Enable all color stopwatches and set keyframes at the playhead"
      >
        <SetAllKeyframesIcon />
      </button>

      <button
        type="button"
        onClick={onAddPrimary}
        disabled={addNodeDisabled}
        title={addNodeDisabled ? addDisabledTitle : 'Add serial primary node'}
      >
        Add Primary
      </button>
      <button
        type="button"
        onClick={onAddWheels}
        disabled={addNodeDisabled}
        title={addNodeDisabled ? addDisabledTitle : 'Add lift gamma gain wheels node'}
      >
        Add Wheels
      </button>
      <button type="button" onClick={onReset}>Reset</button>

    </div>
  );
}
