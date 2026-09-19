import { useMemo, useState } from 'react';

import { useDockStore } from '../../../stores/dockStore';
import { useTimelineStore } from '../../../stores/timeline';
import { ColorEditor } from '../color/ColorEditor';
import { ColorKeyframesPanel } from './ColorKeyframesPanel';
import { ColorToolDock, type ColorAuxMode } from './ColorToolDock';
import './ColorWorkspacePanel.css';

function useSelectedColorClipId(): string | null {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const videoTrackIds = useMemo(
    () => new Set(tracks.filter(track => track.type === 'video').map(track => track.id)),
    [tracks],
  );
  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : [...selectedClipIds].find(clipId => (
        videoTrackIds.has(clips.find(clip => clip.id === clipId)?.trackId ?? '')
      ));

  return selectedClipId
    ?? clips.find(clip => videoTrackIds.has(clip.trackId) && !clip.source?.cameraSettings)?.id
    ?? clips.find(clip => videoTrackIds.has(clip.trackId))?.id
    ?? null;
}

export function ColorNodesPanel() {
  const clipId = useSelectedColorClipId();

  return (
    <section className="color-workspace-nodes color-dock-nodes-panel">
      <div className="color-workspace-nodes-content">
        {clipId
          ? <ColorEditor clipId={clipId} surface="nodes" workspace />
          : <div className="panel-empty"><p>Select a video clip to grade</p></div>}
      </div>
    </section>
  );
}

export function ColorControlsPanel() {
  const clipId = useSelectedColorClipId();
  const clipName = useTimelineStore(state => (
    state.clips.find(clip => clip.id === clipId)?.name ?? 'Selected clip'
  ));
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const [auxMode, setAuxMode] = useState<ColorAuxMode>('scopes');

  const openAuxPanel = (mode: ColorAuxMode) => {
    setAuxMode(mode);
    activatePanelType(mode === 'scopes' ? 'color-scopes' : 'color-keyframes');
  };

  if (!clipId) {
    return <div className="panel-empty"><p>Select a video clip to grade</p></div>;
  }

  return (
    <ColorToolDock
      auxMode={auxMode}
      clipId={clipId}
      clipName={clipName}
      onAuxModeChange={openAuxPanel}
    />
  );
}

export function ColorKeyframesDockPanel() {
  const clipId = useSelectedColorClipId();
  return clipId
    ? <ColorKeyframesPanel clipId={clipId} />
    : <div className="panel-empty"><p>Select a video clip to inspect keyframes</p></div>;
}
