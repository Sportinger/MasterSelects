import type { GaussianSplatLoadProgressEntry } from '../../stores/engineStore';

interface PreviewPlaybackWaiterProps {
  pendingVideoCount: number;
  show: boolean;
}

interface PreviewSplatProgressOverlayProps {
  progress: GaussianSplatLoadProgressEntry | null;
}

interface PreviewEditHintsProps {
  editCameraOrthoHint: string | null;
  effectiveSceneNavFpsMode: boolean;
  isEditableSource: boolean;
  layerTransformMode: boolean;
  maskNavigationMode: boolean;
  sceneNavEnabled: boolean;
  textClipEditMode: boolean;
  textTypingActive: boolean;
}

function formatSplatLoadPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, percent)) * 100);
}

function getSplatLoadPhaseLabel(phase: string): string {
  switch (phase) {
    case 'fetching':
      return 'Fetching splat';
    case 'reading':
      return 'Reading splat';
    case 'parsing':
      return 'Parsing splat';
    case 'normalizing':
      return 'Preparing splat';
    case 'uploading':
      return 'Uploading splat';
    case 'complete':
      return 'Splat loaded';
    case 'error':
      return 'Splat load failed';
    default:
      return 'Loading splat';
  }
}

export function PreviewPlaybackWaiter({
  pendingVideoCount,
  show,
}: PreviewPlaybackWaiterProps) {
  if (!show) return null;

  const detail = pendingVideoCount > 0
    ? `${pendingVideoCount} video${pendingVideoCount === 1 ? '' : 's'}`
    : '';

  return (
    <div
      className="preview-playback-waiter-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="preview-playback-waiter">
        <div className="preview-playback-waiter-spinner" aria-hidden="true" />
        <div className="preview-playback-waiter-copy">
          <span className="preview-playback-waiter-title">Preparing playback</span>
          {detail && (
            <span className="preview-playback-waiter-detail">{detail}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PreviewSplatProgressOverlay({
  progress,
}: PreviewSplatProgressOverlayProps) {
  if (!progress) return null;

  const percent = formatSplatLoadPercent(progress.percent);
  const phaseLabel = getSplatLoadPhaseLabel(progress.phase);

  return (
    <div
      className={`preview-splat-progress-overlay ${progress.phase === 'error' ? 'error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="preview-splat-progress-header">
        <span>{phaseLabel}</span>
        <span>{percent}%</span>
      </div>
      <div className="preview-splat-progress-name">
        {progress.fileName}
      </div>
      <div className="preview-splat-progress-track">
        <div
          className="preview-splat-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function PreviewEditHints({
  editCameraOrthoHint,
  effectiveSceneNavFpsMode,
  isEditableSource,
  layerTransformMode,
  maskNavigationMode,
  sceneNavEnabled,
  textClipEditMode,
  textTypingActive,
}: PreviewEditHintsProps) {
  return (
    <>
      {layerTransformMode && !textClipEditMode && isEditableSource && (
        <div className="preview-edit-hint">
          Drag: Move | Handles: Scale (Shift: Lock Ratio) | Scroll: Zoom | Alt+Drag: Pan
        </div>
      )}
      {textClipEditMode && !textTypingActive && isEditableSource && (
        <div className="preview-edit-hint">
          Text Layer: Drag Move | Handles Scale | Double-click: Edit text
        </div>
      )}
      {textTypingActive && isEditableSource && (
        <div className="preview-edit-hint">
          Text Edit: Type in bounds | Drag handles: Resize | Ctrl+Drag handle: Free corner | Double-click edge: Straighten | Esc: Done
        </div>
      )}
      {maskNavigationMode && isEditableSource && (
        <div className="preview-edit-hint">
          Mask Edit: Scroll Zoom | Alt+Drag/MMB Pan
        </div>
      )}
      {editCameraOrthoHint && (
        <div className="preview-edit-hint">
          {editCameraOrthoHint}
        </div>
      )}
      {sceneNavEnabled && (
        <div className="preview-edit-hint">
          {effectiveSceneNavFpsMode
            ? 'Editor View: 1 Front | 2 Side | 3 Top | 4 Perspective | click preview, hold LMB to look, WASD/QE move, MMB/RMB/Shift+LMB pan, wheel dolly'
            : 'Editor View: 1 Front | 2 Side | 3 Top | 4 Perspective | WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel dolly'}
        </div>
      )}
    </>
  );
}
