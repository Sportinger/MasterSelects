import { useState } from 'react';

import { useDockStore } from '../../../stores/dockStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  ensureColorCorrectionState,
  getEditableColorNodes,
} from '../../../types/colorCorrection';
import { ColorToolDock, type ColorAuxMode } from '../color-workspace/ColorToolDock';
import '../color-workspace/ColorWorkspacePanel.css';
import './ColorTab.css';

interface ColorTabProps {
  clipId: string;
}

export function ColorTab({ clipId }: ColorTabProps) {
  const [auxMode, setAuxMode] = useState<ColorAuxMode>('scopes');
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const selectColorNode = useTimelineStore(state => state.selectColorNode);
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const colorState = ensureColorCorrectionState(clip?.colorCorrection);
  const editableNodes = getEditableColorNodes(colorState);
  const selectedNode = editableNodes.find(node => node.id === colorState.ui.selectedNodeId)
    ?? editableNodes[0];
  const openAuxPanel = (mode: ColorAuxMode) => {
    setAuxMode(mode);
    activatePanelType(mode === 'scopes' ? 'color-scopes' : 'color-keyframes');
  };

  return (
    <div className="properties-tab-content color-tab properties-color-controls">
      <div className="properties-color-node-picker">
        <label htmlFor={`properties-color-node-${clipId}`}>Correction node</label>
        <select
          aria-label="Correction node"
          disabled={editableNodes.length <= 1}
          id={`properties-color-node-${clipId}`}
          onChange={(event) => selectColorNode(clipId, event.currentTarget.value)}
          value={selectedNode?.id ?? ''}
        >
          {editableNodes.length === 0 && <option value="">No correction nodes</option>}
          {editableNodes.map((node, index) => (
            <option key={node.id} value={node.id}>
              {index + 1}. {node.name || 'Correction'} · {node.type === 'wheels' ? 'Wheels' : 'Primary'}
            </option>
          ))}
        </select>
      </div>

      <div className="properties-color-controls-content">
        <ColorToolDock
          auxMode={auxMode}
          clipId={clipId}
          clipName={clip?.name ?? 'Selected clip'}
          onAuxModeChange={openAuxPanel}
        />
      </div>
    </div>
  );
}
