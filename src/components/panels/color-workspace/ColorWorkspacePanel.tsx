import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { ColorEditor } from '../color/ColorEditor';
import type { ColorViewMode } from '../../../types';
import '../color/colorTab.css';

export function ColorWorkspacePanel() {
  const clips = useTimelineStore(state => state.clips);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);

  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0
      ? [...selectedClipIds][0]
      : null;
  const selectedClip = selectedClipId ? clips.find(clip => clip.id === selectedClipId) : null;
  const isAudioOnly = selectedClip?.source?.type === 'audio';
  const isController = selectedClip?.source?.type === 'camera' || selectedClip?.source?.type === 'splat-effector';

  const returnToProperties = (viewMode: ColorViewMode = 'list') => {
    if (selectedClip) {
      useTimelineStore.getState().setColorViewMode(selectedClip.id, viewMode);
    }
    const dock = useDockStore.getState();
    dock.activatePanelType('clip-properties');
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab: 'color' } }));
      dock.hidePanelType('color-workspace');
      dock.activatePanelType('clip-properties');
    });
  };

  if (!selectedClip || isAudioOnly || isController) {
    return (
      <div className="color-workspace-empty">
        <h3>Color</h3>
        <p>Select a visual clip to grade.</p>
      </div>
    );
  }

  return (
    <div className="color-workspace-panel">
      <div className="color-workspace-header">
        <div>
          <h3>Color</h3>
          <span>{selectedClip.name}</span>
        </div>
        <button
          type="button"
          className="color-workspace-return"
          onClick={() => returnToProperties('list')}
          title="Return to List view"
          aria-label="Return to List view"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M2 2h12v12H2V2Zm1.5 1.5v9h3v-9h-3Zm4.5 0v9h4.5v-9H8Z" />
          </svg>
        </button>
      </div>
      <ColorEditor clipId={selectedClip.id} workspace onExitWorkspace={returnToProperties} />
    </div>
  );
}
