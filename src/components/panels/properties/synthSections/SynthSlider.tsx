// Labeled range + number control shared by the synth panel sections (#298).
//
// A tiny presentational control so every section reads the same and the range/
// number pair (with clamping) is written once. Layout-agnostic: it renders one
// `.audio-bus-control-row`, matching the rest of the properties panel.
//
// Motorized fader (plan §14): pass `paramId` to bind the control to the live-value
// bus. During playback a ghost thumb + fill + value badge track the parameter's
// live automated value, so the user sees WHAT is changing and to WHAT value. The
// real thumb stays at the user's base value (we never write the animated value
// back — the additive audio model is untouched). The overlay updates imperatively
// off the bus, so an animating slider never triggers a React re-render.

import { useEffect, useRef } from 'react';
import { liveParamBus } from '../../../../services/midi/instrumentParams/liveParamBus';
import { positionToValue, valueToPosition, type SliderScale } from './sliderScale';

interface SynthSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional unit shown after the label (e.g. "Hz", "s", "cents"). */
  unit?: string;
  /** Perceptual taper: 'log' (frequency/rate), 'power' (gain/time), else linear. */
  scale?: SliderScale;
  /** Exponent for the 'power' taper (default 2). */
  gamma?: number;
  /** Bind to the live-value bus under this id to show the motorized ghost. */
  paramId?: string;
  onChange: (value: number) => void;
}

// Position steps for a non-linear range input — fine enough to feel continuous.
const POSITION_STEP = 0.0001;

function formatLive(value: number, unit?: string, max?: number): string {
  if (unit === 'Hz') return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
  if (max !== undefined && max <= 1) return value.toFixed(2);
  return String(Math.round(value));
}

export function SynthSlider({ label, value, min, max, step = 0.01, unit, scale = 'linear', gamma = 2, paramId, onChange }: SynthSliderProps) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  const isLinear = scale === 'linear';
  const rowRef = useRef<HTMLLabelElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!paramId) return;
    return liveParamBus.subscribe(paramId, (live) => {
      const row = rowRef.current;
      if (!row) return;
      if (live === undefined || max === min) {
        row.classList.remove('is-automating');
        return;
      }
      const pct = valueToPosition(live, min, max, scale, gamma) * 100;
      row.classList.add('is-automating');
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
      if (badgeRef.current) {
        badgeRef.current.style.left = `${pct}%`;
        badgeRef.current.textContent = formatLive(live, unit, max);
      }
    });
  }, [paramId, min, max, unit, scale, gamma]);

  return (
    <label ref={rowRef} className={`audio-bus-control-row synth-slider${paramId ? ' synth-slider-live' : ''}`}>
      <span>{unit ? `${label} (${unit})` : label}</span>
      <div className="synth-slider-track">
        {isLinear ? (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.currentTarget.value)))}
          />
        ) : (
          // Non-linear taper: the range runs on normalized position [0,1]; the
          // real value is mapped through the scale so travel is perceptual.
          <input
            type="range"
            min={0}
            max={1}
            step={POSITION_STEP}
            value={valueToPosition(value, min, max, scale, gamma)}
            onChange={(e) => onChange(clamp(positionToValue(Number(e.currentTarget.value), min, max, scale, gamma)))}
          />
        )}
        {paramId && (
          <>
            <div ref={fillRef} className="synth-slider-ghost-fill" />
            <div ref={thumbRef} className="synth-slider-ghost-thumb" />
            <div ref={badgeRef} className="synth-slider-badge" />
          </>
        )}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.currentTarget.value)))}
      />
    </label>
  );
}
