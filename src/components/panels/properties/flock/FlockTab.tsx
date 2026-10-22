import { useCallback, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useDockStore } from '../../../../stores/dockStore';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import {
  FLOCKING_CARD_PRESET_IDS,
  FLOCK_PRESETS,
  getFlockPreset,
  type FlockPresetDescriptor,
} from '../../../../services/flock/presets/flockPresets';
import { isFlockProperty } from '../../../../types/flock';
import { InspectorSelect, type InspectorSelectGroup } from '../../../inspector/InspectorSelect';
import { ResolveInspectorRow } from '../resolveInspector/ResolveInspectorPrimitives';
import { requestNodeWorkspaceView } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import { FlockAddControlPicker } from './FlockAddControlPicker';
import { FlockDiagnosticsSection } from './FlockDiagnosticsSection';
import { FlockExposedControls } from './FlockExposedControls';
import { FlockTimeQualitySection } from './FlockTimeQualitySection';
import { hasFlockGraph } from '../../../../services/flock/flockEffect';
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

const CUSTOM_PRESET = '';

/** The Preset row's choices: the effect's own presets first, then the other starting swarms. */
function presetGroups(currentId: string): InspectorSelectGroup[] {
  const option = (preset: FlockPresetDescriptor) => ({ value: preset.id, label: preset.label, title: preset.description });
  const own = FLOCKING_CARD_PRESET_IDS.flatMap(id => getFlockPreset(id) ?? []).map(option);
  const more = FLOCK_PRESETS.filter(preset => !FLOCKING_CARD_PRESET_IDS.includes(preset.id)).map(option);
  return [
    ...(currentId === CUSTOM_PRESET ? [{ options: [{ value: CUSTOM_PRESET, label: 'Own graph', disabled: true }] }] : []),
    { options: own },
    { label: 'More swarms', options: more },
  ];
}

/**
 * The card's Preset row (shared inspector row): it names the preset the swarm graph was built from and
 * replaces the graph with another one in one undo step. Only when node keyframes would be lost does
 * it ask first.
 */
function FlockTabHeader({ clip }: { clip: TimelineClip }) {
  const applyFlockPreset = useTimelineStore((state) => state.applyFlockPreset);
  const nodeKeyframes = useTimelineStore((state) => state.clipKeyframes.get(clip.id)?.filter((keyframe) => isFlockProperty(keyframe.property)).length ?? 0);
  const openFlockNodeView = useOpenFlockNodeView();
  const [pending, setPending] = useState<string | null>(null);
  // The graph decides what the row shows, so tools, the Nodes tab and undo can never leave it stale.
  const currentId = clip.flock?.presetId && getFlockPreset(clip.flock.presetId) ? clip.flock.presetId : CUSTOM_PRESET;
  const current = getFlockPreset(currentId);
  const pendingPreset = pending ? getFlockPreset(pending) : undefined;

  const applyPreset = (presetId: string) => {
    startBatch('Apply flock preset');
    try {
      applyFlockPreset(clip.id, presetId);
    } finally {
      endBatch();
    }
    setPending(null);
  };

  return (
    <div className="properties-section flock-tab-header">
      <ResolveInspectorRow label="Preset">
        <InspectorSelect
          ariaLabel="Flock preset"
          value={currentId}
          groups={presetGroups(currentId)}
          onChange={(presetId) => (nodeKeyframes ? setPending(presetId) : applyPreset(presetId))}
        />
      </ResolveInspectorRow>
      {current && <p className="properties-hint flock-preset-hint">{current.description}</p>}
      {pendingPreset && (
        <div className="flock-confirm" role="group" aria-label="Confirm preset">
          <span>Replace the swarm with “{pendingPreset.label}”? Its {nodeKeyframes === 1 ? 'node keyframe is' : `${nodeKeyframes} node keyframes are`} removed.</span>
          <div className="flock-button-row">
            <button type="button" className="flock-button flock-button-primary" onPointerUp={blurOnPointer} onClick={() => applyPreset(pendingPreset.id)}>
              Replace
            </button>
            <button type="button" className="flock-button" onPointerUp={blurOnPointer} onClick={() => setPending(null)}>
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

  if (!clip || !hasFlockGraph(clip) || !clip.flock) {
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
