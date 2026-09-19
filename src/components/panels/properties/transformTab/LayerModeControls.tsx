interface LayerDimensionToggleProps {
  ariaLabelPrefix?: string;
  isEffectively3D: boolean;
  isLocked3D: boolean;
  onToggle3D: () => void;
}

export function LayerDimensionToggle({
  ariaLabelPrefix,
  isEffectively3D,
  isLocked3D,
  onToggle3D,
}: LayerDimensionToggleProps) {
  if (isLocked3D) {
    return (
      <span
        className="transform-dimension-required"
        aria-label={ariaLabelPrefix ? `${ariaLabelPrefix}: 3D layer required` : '3D layer required'}
        title="This layer requires 3D"
      >
        3D
      </span>
    );
  }

  const actionLabel = isEffectively3D ? 'Switch to 2D layer' : 'Switch to 3D layer';

  return (
    <button
      type="button"
      className={`transform-dimension-toggle${isEffectively3D ? ' is-3d' : ''}`}
      onClick={onToggle3D}
      aria-label={ariaLabelPrefix ? `${ariaLabelPrefix}: ${actionLabel}` : actionLabel}
      aria-pressed={isEffectively3D}
      title={isEffectively3D ? 'Switch to 2D layer' : 'Switch to 3D layer'}
    >
      <span className="transform-dimension-label transform-dimension-label-2d">2D</span>
      <span className="transform-dimension-track" aria-hidden="true">
        <span className="transform-dimension-knob" />
      </span>
      <span className="transform-dimension-label transform-dimension-label-3d">3D</span>
    </button>
  );
}

interface LayerModeControlsProps extends LayerDimensionToggleProps {
  freeRun: boolean;
  showDimensionToggle?: boolean;
  supportsFreeRun: boolean;
  onFreeRunToggle: () => void;
}

export function LayerModeControls({
  freeRun,
  isEffectively3D,
  isLocked3D,
  showDimensionToggle = true,
  supportsFreeRun,
  onFreeRunToggle,
  onToggle3D,
}: LayerModeControlsProps) {
  return (
    <div className="transform-layer-mode-controls">
      {showDimensionToggle && (
        <LayerDimensionToggle
          isEffectively3D={isEffectively3D}
          isLocked3D={isLocked3D}
          onToggle3D={onToggle3D}
        />
      )}
      {supportsFreeRun && (
        <button
          type="button"
          className={`transform-dimension-toggle transform-free-run-toggle${freeRun ? ' is-free' : ''}`}
          onClick={onFreeRunToggle}
          aria-label={`Playback Mode: ${freeRun ? 'Switch to Timeline Lock' : 'Switch to Free Run'}`}
          aria-pressed={freeRun}
          title={freeRun ? 'Lock playback to the timeline' : 'Let the source run independently'}
        >
          <span className="transform-dimension-label transform-free-run-label-lock">Lock</span>
          <span className="transform-dimension-track" aria-hidden="true">
            <span className="transform-dimension-knob" />
          </span>
          <span className="transform-dimension-label transform-free-run-label-free">Free</span>
        </button>
      )}
    </div>
  );
}
