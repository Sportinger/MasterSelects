import { useRef, useState } from 'react';
import { LiquidGlassLens } from '../../common/liquidGlass/LiquidGlassBubble';
import { ResolutionOrientationToggle } from '../../common/ResolutionOrientationToggle';
import { LabeledValue } from '../properties/LabeledValue';
import './CompositionSettingsDialog.css';

const FRAME_RATE_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;
const RESOLUTION_PRESETS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K', width: 3840, height: 2160 },
] as const;

export interface CompositionSettingsValues {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
}

interface CompositionSettingsDialogProps {
  settings: CompositionSettingsValues;
  isCreating?: boolean;
  onSettingsChange: (settings: CompositionSettingsValues) => void;
  onSave: () => void;
  onCancel: () => void;
}

type ResolutionAxis = 'width' | 'height';

function clampDimension(value: number): number {
  return Math.max(1, Math.min(16384, Math.round(value)));
}

export function updateLinkedCompositionResolution(
  settings: CompositionSettingsValues,
  axis: ResolutionAxis,
  value: number,
  aspectRatio: number,
): CompositionSettingsValues {
  const nextValue = clampDimension(value);
  const safeRatio = Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : settings.width / Math.max(settings.height, 1);
  return axis === 'width'
    ? {
        ...settings,
        width: nextValue,
        height: clampDimension(nextValue / safeRatio),
      }
    : {
        ...settings,
        width: clampDimension(nextValue * safeRatio),
        height: nextValue,
      };
}

function isFrameRatePreset(frameRate: number): boolean {
  return FRAME_RATE_PRESETS.some((preset) => preset === frameRate);
}

export function CompositionSettingsDialog({
  settings,
  isCreating = false,
  onSettingsChange,
  onSave,
  onCancel,
}: CompositionSettingsDialogProps) {
  const [resolutionLinked, setResolutionLinked] = useState(true);
  const [customFrameRate, setCustomFrameRate] = useState(() => !isFrameRatePreset(settings.frameRate));
  const linkedAspectRatio = useRef(settings.width / Math.max(settings.height, 1));
  const isPortrait = settings.height > settings.width;

  const changeResolution = (axis: ResolutionAxis, value: number) => {
    if (resolutionLinked) {
      onSettingsChange(updateLinkedCompositionResolution(
        settings,
        axis,
        value,
        linkedAspectRatio.current,
      ));
      return;
    }
    onSettingsChange({ ...settings, [axis]: clampDimension(value) });
  };

  const toggleResolutionLink = () => {
    setResolutionLinked((current) => {
      if (!current) {
        linkedAspectRatio.current = settings.width / Math.max(settings.height, 1);
      }
      return !current;
    });
  };

  const swapOrientation = () => {
    linkedAspectRatio.current = settings.height / Math.max(settings.width, 1);
    onSettingsChange({
      ...settings,
      width: settings.height,
      height: settings.width,
    });
  };

  const applyResolutionPreset = (width: number, height: number) => {
    const nextWidth = isPortrait ? height : width;
    const nextHeight = isPortrait ? width : height;
    linkedAspectRatio.current = nextWidth / nextHeight;
    onSettingsChange({ ...settings, width: nextWidth, height: nextHeight });
  };

  return (
    <div className="comp-settings-overlay" onMouseDown={onCancel}>
      <div
        className="comp-settings-dialog composition-settings-dialog transform-tab-compact ms-liquid-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composition-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <LiquidGlassLens />
        <header className="composition-settings-header">
          <h3 id="composition-settings-title">Composition Settings</h3>
        </header>

        <label className="composition-settings-name">
          <span>Name</span>
          <input
            type="text"
            value={settings.name}
            onChange={(event) => onSettingsChange({ ...settings, name: event.target.value })}
            autoFocus={isCreating}
            aria-label="Composition name"
          />
        </label>

        <section className="properties-section composition-settings-section">
          <div className="composition-settings-section-head">
            <span>Resolution</span>
            <div className="composition-settings-resolution-summary">
              <ResolutionOrientationToggle
                width={settings.width}
                height={settings.height}
                onToggle={swapOrientation}
              />
              <strong>{isPortrait ? 'Portrait' : 'Landscape'}</strong>
            </div>
          </div>

          <div className="composition-settings-resolution-row">
            <LabeledValue
              label="W"
              value={settings.width}
              onChange={(value) => changeResolution('width', value)}
              defaultValue={1920}
              decimals={0}
              suffix=" px"
              min={1}
              max={16384}
              sensitivity={2}
              ariaLabel="Composition width"
            />
            <button
              type="button"
              className={`composition-resolution-link${resolutionLinked ? ' is-active' : ''}`}
              onClick={toggleResolutionLink}
              aria-label={resolutionLinked ? 'Unlink resolution dimensions' : 'Link resolution dimensions'}
              aria-pressed={resolutionLinked}
              title={resolutionLinked ? 'Width and height are linked' : 'Width and height are independent'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.5 14.5 14.5 9.5" />
                <path d="M7.2 16.8 5.6 18.4a3.4 3.4 0 0 1-4.8-4.8l3.5-3.5a3.4 3.4 0 0 1 4.8 0" />
                <path d="m16.8 7.2 1.6-1.6a3.4 3.4 0 0 1 4.8 4.8l-3.5 3.5a3.4 3.4 0 0 1-4.8 0" />
              </svg>
            </button>
            <LabeledValue
              label="H"
              value={settings.height}
              onChange={(value) => changeResolution('height', value)}
              defaultValue={1080}
              decimals={0}
              suffix=" px"
              min={1}
              max={16384}
              sensitivity={2}
              ariaLabel="Composition height"
            />
          </div>

          <div className="composition-settings-preset-row" aria-label="Resolution presets">
            {RESOLUTION_PRESETS.map((preset) => {
              const width = isPortrait ? preset.height : preset.width;
              const height = isPortrait ? preset.width : preset.height;
              const active = settings.width === width && settings.height === height;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`composition-settings-chip${active ? ' is-active' : ''}`}
                  onClick={() => applyResolutionPreset(preset.width, preset.height)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="properties-section composition-settings-section composition-settings-timing">
          <div className="composition-settings-section-head">
            <span>Timing</span>
          </div>

          <div className="composition-settings-timing-row">
            <label htmlFor="composition-frame-rate">Frame Rate</label>
            <select
              id="composition-frame-rate"
              value={customFrameRate ? 'custom' : String(settings.frameRate)}
              onChange={(event) => {
                if (event.target.value === 'custom') {
                  setCustomFrameRate(true);
                  return;
                }
                setCustomFrameRate(false);
                onSettingsChange({ ...settings, frameRate: Number(event.target.value) });
              }}
            >
              {FRAME_RATE_PRESETS.map((frameRate) => (
                <option key={frameRate} value={frameRate}>{frameRate} fps</option>
              ))}
              <option value="custom">Custom...</option>
            </select>
            {customFrameRate && (
              <LabeledValue
                className="composition-settings-custom-fps"
                label="FPS"
                value={settings.frameRate}
                onChange={(value) => onSettingsChange({
                  ...settings,
                  frameRate: Math.max(1, Math.min(240, value)),
                })}
                defaultValue={30}
                decimals={3}
                suffix=" fps"
                min={1}
                max={240}
                sensitivity={1}
                ariaLabel="Custom composition frame rate"
              />
            )}
          </div>

          <div className="composition-settings-timing-row">
            <span>Duration</span>
            <LabeledValue
              className="composition-settings-duration"
              label="Sec"
              value={settings.duration}
              onChange={(value) => onSettingsChange({
                ...settings,
                duration: Math.max(1, Math.min(86400, value)),
              })}
              defaultValue={60}
              decimals={2}
              suffix=" s"
              min={1}
              max={86400}
              sensitivity={2}
              ariaLabel="Composition duration"
            />
          </div>
        </section>

        <p className="composition-settings-preview-note">
          Resolution changes update the active preview live. Existing layers keep their visual size.
        </p>

        <footer className="composition-settings-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn btn-active"
            onClick={onSave}
            disabled={!settings.name.trim()}
          >
            {isCreating ? 'Create' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
