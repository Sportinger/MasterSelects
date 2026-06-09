import type { MediaPanelViewMode } from './types';

export interface MediaViewModeControlsProps {
  viewMode: MediaPanelViewMode;
  onViewModeChange: (mode: MediaPanelViewMode) => void;
}

export function MediaViewModeControls({
  viewMode,
  onViewModeChange,
}: MediaViewModeControlsProps) {
  return (
    <div className="media-view-segment" role="tablist" aria-label="Media view mode">
      <button
        className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'classic' ? 'active' : ''}`}
        onClick={() => onViewModeChange('classic')}
        title="Classic list view"
        aria-label="Classic list view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
      </button>
      <button
        className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'icons' ? 'active' : ''}`}
        onClick={() => onViewModeChange('icons')}
        title="Large icon view"
        aria-label="Large icon view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
      </button>
      <button
        className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'board' ? 'active' : ''}`}
        onClick={() => onViewModeChange('board')}
        title="Board view"
        aria-label="Board view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2h5v4H2V2Zm7 0h5v6H9V2ZM2 8h5v6H2V8Zm7 2h5v4H9v-4Z"/></svg>
      </button>
    </div>
  );
}
