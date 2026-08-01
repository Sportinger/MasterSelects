import type { EncoderType } from './useExportState';

interface ExportAdvancedSummarySectionsProps {
  encoder: EncoderType;
  isGifMode: boolean;
  stackedAlpha: boolean;
  setStackedAlpha: (enabled: boolean) => void;
  actualWidth: number;
  actualHeight: number;
  outputHeight: number;
  useInOut: boolean;
  setUseInOut: (enabled: boolean) => void;
  startTime: number;
  endTime: number;
  frameCount: number;
  estimatedSizeLabel: string;
  error: string | null;
  formatTime: (seconds: number) => string;
  fixedSourceRange?: boolean;
}

export function ExportAdvancedSummarySections({
  encoder,
  isGifMode,
  stackedAlpha,
  setStackedAlpha,
  actualWidth,
  actualHeight,
  outputHeight,
  useInOut,
  setUseInOut,
  startTime,
  endTime,
  frameCount,
  estimatedSizeLabel,
  error,
  formatTime,
  fixedSourceRange = false,
}: ExportAdvancedSummarySectionsProps) {
  return (
    <>
      {!fixedSourceRange && (encoder === 'webcodecs' || encoder === 'htmlvideo') && !isGifMode && (
        <div className="export-section export-advanced-section">
          <div className="export-section-header">Advanced Alpha</div>

          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={stackedAlpha}
                onChange={(e) => setStackedAlpha(e.target.checked)}
              />
              Stacked Alpha (transparent video)
            </label>
          </div>

          {stackedAlpha && (
            <div style={{
              padding: '8px 10px',
              background: 'rgba(255, 170, 0, 0.1)',
              border: '1px solid rgba(255, 170, 0, 0.3)',
              borderRadius: '4px',
              fontSize: '11px',
              color: 'var(--warning, #ffaa00)',
              lineHeight: 1.4,
            }}>
              Output: {actualWidth}x{actualHeight * 2}px (doubled height).
              Top half = RGB, bottom half = alpha as grayscale.
            </div>
          )}
        </div>
      )}

      <div className="export-section export-advanced-section">
        <div className="export-section-header">Range & Summary</div>

        {!fixedSourceRange && <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={useInOut}
              onChange={(e) => setUseInOut(e.target.checked)}
            />
            Use In/Out Markers
          </label>
        </div>}

        <div className="export-summary">
          <div>Output: {actualWidth}x{outputHeight}{stackedAlpha && !isGifMode ? ' (stacked alpha)' : ''}</div>
          <div>Range: {fixedSourceRange ? 'Full source' : `${formatTime(startTime)} - ${formatTime(endTime)}`}</div>
          <div>Duration: {formatTime(endTime - startTime)}</div>
          <div>Frames: {frameCount}</div>
          <div>Est. Size: {estimatedSizeLabel}</div>
        </div>
      </div>

      {error && <div className="export-error" role="alert">{error}</div>}
    </>
  );
}
