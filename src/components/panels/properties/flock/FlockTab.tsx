import { useCallback, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useDockStore } from '../../../../stores/dockStore';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import {
  DEFAULT_FLOCK_PRESET_ID,
  FLOCK_PRESETS,
  getFlockPreset,
} from '../../../../services/flock/presets/flockPresets';
import { requestNodeWorkspaceView } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import { FlockAddControlPicker } from './FlockAddControlPicker';
import { FlockDiagnosticsSection } from './FlockDiagnosticsSection';
import { FlockExposedControls } from './FlockExposedControls';
import { FlockTimeQualitySection } from './FlockTimeQualitySection';
import './FlockTab.css';

function blurOnPointer(event: React.PointerEvent<HTMLButtonElement>) {
  event.currentTarget.blur();
}

/** Selects the clip, opens the Node Workspace and asks it to show the clip's Flock view. */
function useOpenFlockNodeView(): (clipId: string) => void {
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const activatePanelType = useDockStore((state) => state.activatePanelType);
  return useCallback((clipId: string) => {
    if (!selectedClipIds.has(clipId)) selectClip(clipId);
    activatePanelType('node-workspace');
    requestNodeWorkspaceView(clipId, 'flock');
  }, [activatePanelType, selectClip, selectedClipIds]);
}

function FlockTabHeader({ clip }: { clip: TimelineClip }) {
  const applyFlockPreset = useTimelineStore((state) => state.applyFlockPreset);
  const openFlockNodeView = useOpenFlockNodeView();
  const [presetId, setPresetId] = useState(clip.flock?.presetId && getFlockPreset(clip.flock.presetId)
    ? clip.flock.presetId
    : DEFAULT_FLOCK_PRESET_ID);
  const [confirming, setConfirming] = useState(false);
  const preset = getFlockPreset(presetId);

  const applyPreset = () => {
    startBatch('Apply flock preset');
    try {
      applyFlockPreset(clip.id, presetId);
    } finally {
      endBatch();
    }
    setConfirming(false);
  };

  return (
    <div className="properties-section flock-tab-header">
      <div className="control-row">
        <label className="prop-label" htmlFor={`flock-preset-${clip.id}`}>Preset</label>
        <select
          id={`flock-preset-${clip.id}`}
          aria-label="Flock preset"
          value={presetId}
          onChange={(event) => {
            setPresetId(event.target.value);
            setConfirming(false);
          }}
        >
          {FLOCK_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </select>
        <button type="button" className="flock-button" onPointerUp={blurOnPointer} onClick={() => setConfirming(true)}>
          Apply
        </button>
      </div>
      {preset && <p className="properties-hint">{preset.description}</p>}
      {confirming && (
        <div className="flock-confirm" role="group" aria-label="Confirm preset">
          <span>Replace the graph with “{preset?.label ?? presetId}”? Node keyframes on this clip are removed.</span>
          <div className="flock-button-row">
            <button type="button" className="flock-button flock-button-primary" onPointerUp={blurOnPointer} onClick={applyPreset}>
              Replace
            </button>
            <button type="button" className="flock-button" onPointerUp={blurOnPointer} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="control-row flock-button-row">
        <button type="button" className="flock-button flock-button-primary" onPointerUp={blurOnPointer} onClick={() => openFlockNodeView(clip.id)}>
          Open Nodes
        </button>
        <span className="flock-meta">{clip.flock?.nodes.length ?? 0} nodes · {clip.flock?.exposed.length ?? 0} controls</span>
      </div>
    </div>
  );
}

export function FlockTab({ clipId }: { clipId: string }) {
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId));
  const keyframes = useTimelineStore((state) => state.clipKeyframes.get(clipId));
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getSourceTimeForClip = useTimelineStore((state) => state.getSourceTimeForClip);

  if (!clip || clip.source?.type !== 'flock' || !clip.flock) {
    return <div className="panel-empty"><p>This clip has no flock definition.</p></div>;
  }

  const ctx = {
    clip,
    keyframes,
    clipLocalTime: playheadPosition - clip.startTime,
    resolveSourceOffset: getSourceTimeForClip,
  };

  return (
    <div className="flock-tab">
      <FlockTabHeader key={clip.id} clip={clip} />
      <FlockDiagnosticsSection clip={clip} />
      <FlockExposedControls ctx={ctx} />
      <FlockAddControlPicker clip={clip} />
      <FlockTimeQualitySection key={`time-${clip.id}`} clip={clip} />
    </div>
  );
}
