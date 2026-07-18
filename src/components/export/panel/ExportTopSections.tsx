import type { ExportPreset } from '../../../stores/exportStore';
import type { ExportSummaryBadge, ExportSummaryTarget } from '../exportSummaryState';
import type { EncoderType } from '../useExportState';

interface ExportSummaryBadgesSectionProps {
  showCompositionSync: boolean;
  sameAsComposition: boolean;
  summaryBadges: ExportSummaryBadge[];
  primaryExportLabel: string;
  estimatedSizeLabel: string;
  exportDisabled: boolean;
  onPrimaryExport: () => void;
  onSyncComposition: () => void;
  onScrollToSummaryTarget: (target: ExportSummaryTarget) => void;
}

export function ExportSummaryBadgesSection({
  showCompositionSync,
  sameAsComposition,
  summaryBadges,
  primaryExportLabel,
  estimatedSizeLabel,
  exportDisabled,
  onPrimaryExport,
  onSyncComposition,
  onScrollToSummaryTarget,
}: ExportSummaryBadgesSectionProps) {
  return (
    <section className="export-hero-card export-summary-sticky export-summary-badges">
      <div className="export-summary-actions">
        <div className="export-pill-row">
          {showCompositionSync && (
            <button
              type="button"
              className={`export-pill export-pill-${sameAsComposition ? 'sac' : 'nac'}`}
              onClick={onSyncComposition}
              aria-label={sameAsComposition ? 'Same as composition' : 'Use composition resolution and frame rate'}
              title={sameAsComposition ? 'Same as composition' : 'Use composition resolution and frame rate'}
            >
              {sameAsComposition ? 'SaC' : 'NaC'}
            </button>
          )}
          {summaryBadges.map((badge) => (
            <button
              key={`${badge.target}-${badge.label}`}
              type="button"
              className={`export-pill${badge.warning ? ' export-pill-warning' : ''}`}
              onClick={() => onScrollToSummaryTarget(badge.target)}
              title={`Show ${badge.label} settings`}
            >
              {badge.label}
            </button>
          ))}
          <button
            type="button"
            className="export-pill export-summary-cta"
            onClick={onPrimaryExport}
            disabled={exportDisabled}
            title={`${primaryExportLabel}${estimatedSizeLabel.startsWith('~') ? ` ${estimatedSizeLabel}` : ''}`}
          >
            <span>{primaryExportLabel}</span>
            {estimatedSizeLabel.startsWith('~') && (
              <span className="export-summary-cta-size">{estimatedSizeLabel}</span>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

interface ExportPresetCommandSectionProps {
  presets: ExportPreset[];
  selectedPresetId: string | null;
  setupStatus: string | null;
  onSelectPreset: (presetId: string | null) => void;
  onLoad: () => void;
  onUpdate: () => void;
  onSave: () => void;
}

export function ExportPresetCommandSection({
  presets,
  selectedPresetId,
  setupStatus,
  onSelectPreset,
  onLoad,
  onUpdate,
  onSave,
}: ExportPresetCommandSectionProps) {
  return (
    <div className="export-section export-command-row" data-export-target="command-bar">
      <div className="export-command-bar">
        <div className="export-command-actions">
          <div className="export-preset-picker">
            <select
              id="export-preset-select"
              aria-label="Export preset"
              value={selectedPresetId ?? ''}
              onChange={(e) => onSelectPreset(e.target.value || null)}
            >
              <option value="">Project presets</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="export-chip" onClick={onLoad} disabled={!selectedPresetId}>
            Load
          </button>
          <button type="button" className="export-chip" onClick={onUpdate} disabled={!selectedPresetId}>
            Update
          </button>
          <button type="button" className="export-chip" onClick={onSave}>
            Save
          </button>
        </div>
      </div>

      {setupStatus && (
        <div className="export-inline-note">
          {setupStatus}
        </div>
      )}
    </div>
  );
}

interface ExportWorkflowSectionProps {
  encoder: EncoderType;
  webCodecsAvailable: boolean;
  ffmpegAvailable: boolean;
  isFFmpegMultiThreaded: boolean;
  isFFmpegReady: boolean;
  isFFmpegLoading: boolean;
  ffmpegLoadError: string | null;
  onSetEncoder: (encoder: EncoderType) => void;
  onLoadFFmpeg: () => void;
}

export function ExportWorkflowSection({
  encoder,
  webCodecsAvailable,
  ffmpegAvailable,
  isFFmpegMultiThreaded,
  isFFmpegReady,
  isFFmpegLoading,
  ffmpegLoadError,
  onSetEncoder,
  onLoadFFmpeg,
}: ExportWorkflowSectionProps) {
  return (
    <div className="export-section export-workflow-section">
      <div className="export-section-header">Workflow</div>
      <div className="export-method-grid">
        {webCodecsAvailable && (
          <button
            type="button"
            className={`export-method-card${encoder === 'webcodecs' ? ' is-active' : ''}`}
            onClick={() => onSetEncoder('webcodecs')}
          >
            <span className="export-method-chip">Fast</span>
            <strong>WebCodecs</strong>
            <span>Hardware-assisted browser export for quick delivery files.</span>
          </button>
        )}
        {webCodecsAvailable && (
          <button
            type="button"
            className={`export-method-card${encoder === 'htmlvideo' ? ' is-active' : ''}`}
            onClick={() => onSetEncoder('htmlvideo')}
          >
            <span className="export-method-chip">Precise</span>
            <strong>HTMLVideo</strong>
            <span>Explicit HTMLVideo seeking when accuracy matters more than speed.</span>
          </button>
        )}
        {ffmpegAvailable && (
          <button
            type="button"
            className={`export-method-card${encoder === 'ffmpeg' ? ' is-active' : ''}`}
            onClick={() => onSetEncoder('ffmpeg')}
          >
            <span className="export-method-chip">CPU</span>
            <strong>FFmpeg</strong>
            <span>Intermediates, archival codecs, and NLE-friendly containers.</span>
          </button>
        )}
      </div>
      <div className="control-row export-legacy-control">
        <label>Method</label>
        <select
          value={encoder}
          onChange={(e) => onSetEncoder(e.target.value as EncoderType)}
        >
          {webCodecsAvailable && (
            <option value="webcodecs">âš¡ WebCodecs (Fast)</option>
          )}
          {webCodecsAvailable && (
            <option value="htmlvideo">ðŸŽ¯ HTMLVideo (Precise)</option>
          )}
          {ffmpegAvailable && (
            <option value="ffmpeg">
              FFmpeg (CPU){!isFFmpegMultiThreaded ? ' - ST' : ''}
            </option>
          )}
        </select>
      </div>

      {encoder === 'ffmpeg' && (
        <div className="export-status-row">
          {!isFFmpegReady ? (
            <button
              type="button"
              onClick={onLoadFFmpeg}
              disabled={isFFmpegLoading}
              className="btn-small export-status-button"
            >
              {isFFmpegLoading ? 'Loading FFmpeg...' : 'Load FFmpeg Runtime'}
            </button>
          ) : (
            <span className="export-status-ok">
              FFmpeg Ready
            </span>
          )}
        </div>
      )}

      {ffmpegLoadError && encoder === 'ffmpeg' && (
        <div className="export-error export-error-inline">
          {ffmpegLoadError}
        </div>
      )}
    </div>
  );
}
