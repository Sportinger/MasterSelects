import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { AudioMeterSnapshot } from '../../../types';
import { AUDIO_METER_FLOOR_DB, audioMeterDbToUnit } from '../../../services/audio/audioMetering';
import type {
  RuntimeAudioMeterFeature,
  RuntimeAudioMeterScope,
} from '../../../services/audio/runtimeAudioMeterBus';
import {
  useRuntimeAudioMeterFrame,
} from '../../../services/audio/runtimeAudioMeterHooks';

interface AudioLevelMeterProps {
  /** Static snapshot mode: render a fixed snapshot. */
  meter?: AudioMeterSnapshot;
  /** Streaming mode: subscribe to the runtime meter bus and animate via refs/CSS. */
  streamScope?: RuntimeAudioMeterScope;
  streamFeatures?: readonly RuntimeAudioMeterFeature[];
  label: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  display?: 'mono' | 'stereo' | 'auto';
}

function formatDb(value: number): string {
  if (value <= AUDIO_METER_FLOOR_DB + 0.5) return '-inf dB';
  return `${value.toFixed(1)} dB`;
}

function formatUnit(value: number): string {
  return value.toFixed(2);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const METER_ATTACK_MS = 300;
const METER_DECAY_MS = 1000;
const METER_DECAY_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const METER_ATTACK_EASING = 'linear';

function updateMeterTransition(
  element: HTMLElement,
  unit: number,
  properties: readonly string[],
): void {
  const previousUnit = Number.parseFloat(element.dataset.meterUnit ?? '');
  const decaying = Number.isFinite(previousUnit) && unit < previousUnit;
  const mode = decaying ? 'decay' : 'attack';
  const propertyKey = properties.join(',');
  if (
    element.dataset.meterTransitionMode !== mode ||
    element.dataset.meterTransitionProperties !== propertyKey
  ) {
    const duration = decaying ? METER_DECAY_MS : METER_ATTACK_MS;
    const easing = decaying ? METER_DECAY_EASING : METER_ATTACK_EASING;
    const opacityDuration = decaying ? METER_DECAY_MS : 100;
    element.style.transition = [
      ...properties.map((property) => `${property} ${duration}ms ${easing}`),
      `opacity ${opacityDuration}ms ease`,
    ].join(', ');
    element.dataset.meterTransitionMode = mode;
    element.dataset.meterTransitionProperties = propertyKey;
  }
  element.dataset.meterUnit = String(unit);
}

function meterFillTransform(unit: number, orientation: 'horizontal' | 'vertical'): string {
  return orientation === 'vertical' ? 'none' : `scaleX(${unit})`;
}

function meterFillClipPath(unit: number, orientation: 'horizontal' | 'vertical'): string | undefined {
  return orientation === 'vertical' ? `inset(${(1 - unit) * 100}% 0 0 0)` : undefined;
}

function meterFillStyle(
  unit: number,
  hasMeter: boolean,
  orientation: 'horizontal' | 'vertical',
  opacity: number,
): CSSProperties {
  return {
    transform: meterFillTransform(unit, orientation),
    clipPath: meterFillClipPath(unit, orientation),
    opacity: hasMeter && unit > 0 ? opacity : 0,
  };
}

function meterMarkerStyle(
  unit: number,
  hasMeter: boolean,
  orientation: 'horizontal' | 'vertical',
): CSSProperties {
  return orientation === 'vertical'
    ? {
        bottom: `${unit * 100}%`,
        transform: 'translateY(50%)',
        opacity: hasMeter && unit > 0 ? 1 : 0,
      }
    : {
        left: `${unit * 100}%`,
        transform: 'translateX(-50%)',
        opacity: hasMeter && unit > 0 ? 1 : 0,
      };
}

function buildMeterTitle(label: string, meter: AudioMeterSnapshot | undefined, resolvedDisplay: 'mono' | 'stereo'): string {
  if (!meter) return `${label}: no live signal`;
  const phaseCorrelation = Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const stereoWidth = Number.isFinite(meter.stereoWidth) ? meter.stereoWidth : undefined;
  return `${label}: peak ${formatDb(meter.peakDb)}, rms ${formatDb(meter.rmsDb)}${
    resolvedDisplay === 'stereo' && meter.channels
      ? `, L ${formatDb(meter.channels.left.peakDb)}, R ${formatDb(meter.channels.right.peakDb)}`
      : ''
  }${
    phaseCorrelation !== undefined ? `, phase ${formatUnit(phaseCorrelation)}` : ''
  }${stereoWidth !== undefined ? `, width ${formatUnit(stereoWidth)}` : ''}`;
}

// ── Static (prop-driven) rendering ──────────────────────────────────────────

function StaticAudioLevelMeter({
  meter,
  label,
  className = '',
  orientation = 'horizontal',
  display = 'mono',
}: AudioLevelMeterProps) {
  const hasStereoChannels = Boolean(meter?.channels);
  const resolvedDisplay = display === 'auto'
    ? (hasStereoChannels ? 'stereo' : 'mono')
    : display;
  const peak = clampUnit(meter ? audioMeterDbToUnit(meter.peakDb) : 0);
  const rms = clampUnit(meter ? audioMeterDbToUnit(meter.rmsDb) : 0);
  const leftPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.peakDb ?? meter.peakDb) : 0);
  const leftRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.rmsDb ?? meter.rmsDb) : 0);
  const rightPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.peakDb ?? meter.peakDb) : 0);
  const rightRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.rmsDb ?? meter.rmsDb) : 0);
  const phaseCorrelation = meter && Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const phaseUnit = phaseCorrelation !== undefined ? clampUnit((phaseCorrelation + 1) / 2) : 0.5;
  const peakFillStyle = {
    transform: meterFillTransform(peak, orientation),
    clipPath: meterFillClipPath(peak, orientation),
    opacity: meter && peak > 0 ? 0.68 : 0,
  } as CSSProperties;
  const rmsStyle = {
    transform: meterFillTransform(rms, orientation),
    clipPath: meterFillClipPath(rms, orientation),
    opacity: meter && rms > 0 ? 0.9 : 0,
  } as CSSProperties;
  const peakStyle = orientation === 'vertical'
    ? {
        bottom: `${peak * 100}%`,
        transform: 'translateY(50%)',
        opacity: meter && peak > 0 ? 1 : 0,
      }
    : {
        left: `${peak * 100}%`,
        transform: 'translateX(-50%)',
        opacity: meter && peak > 0 ? 1 : 0,
      };
  const phaseStyle = orientation === 'vertical'
    ? {
        bottom: `${phaseUnit * 100}%`,
        transform: 'translateY(50%)',
        opacity: phaseCorrelation !== undefined ? 0.95 : 0,
      }
    : {
        left: `${phaseUnit * 100}%`,
        transform: 'translateX(-50%)',
        opacity: phaseCorrelation !== undefined ? 0.95 : 0,
      };
  const title = buildMeterTitle(label, meter, resolvedDisplay);
  const hasMeter = Boolean(meter);

  if (resolvedDisplay === 'stereo') {
    return (
      <div
        className={`audio-level-meter stereo ${orientation} ${meter?.clipping ? 'clipping' : ''} ${className}`.trim()}
        role="meter"
        aria-label={label}
        aria-valuemin={AUDIO_METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={meter?.peakDb ?? AUDIO_METER_FLOOR_DB}
        title={title}
      >
        <div className="audio-level-meter-stereo-channel left">
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" style={meterFillStyle(leftPeak, hasMeter, orientation, 0.68)} />
          <div className="audio-level-meter-rms" style={meterFillStyle(leftRms, hasMeter, orientation, 0.52)} />
          <div className="audio-level-meter-peak" style={meterMarkerStyle(leftPeak, hasMeter, orientation)} />
        </div>
        <div className="audio-level-meter-stereo-channel right">
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" style={meterFillStyle(rightPeak, hasMeter, orientation, 0.68)} />
          <div className="audio-level-meter-rms" style={meterFillStyle(rightRms, hasMeter, orientation, 0.52)} />
          <div className="audio-level-meter-peak" style={meterMarkerStyle(rightPeak, hasMeter, orientation)} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`audio-level-meter ${orientation} ${meter?.clipping ? 'clipping' : ''} ${className}`.trim()}
      role="meter"
      aria-label={label}
      aria-valuemin={AUDIO_METER_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={meter?.peakDb ?? AUDIO_METER_FLOOR_DB}
      title={title}
    >
      <div className="audio-level-meter-scale" />
      <div className="audio-level-meter-peak-fill" style={peakFillStyle} />
      <div className="audio-level-meter-rms" style={rmsStyle} />
      <div className="audio-level-meter-phase" style={phaseStyle} />
      <div className="audio-level-meter-peak" style={peakStyle} />
    </div>
  );
}

// ── Streaming (bus-driven) rendering ────────────────────────────────────────

function applyMonoMeterStyles(
  peakFill: HTMLElement | null,
  rms: HTMLElement | null,
  peakMarker: HTMLElement | null,
  phase: HTMLElement | null,
  meter: AudioMeterSnapshot | undefined,
  orientation: 'horizontal' | 'vertical',
): void {
  const hasMeter = Boolean(meter);
  const peak = clampUnit(meter ? audioMeterDbToUnit(meter.peakDb) : 0);
  const rmsUnit = clampUnit(meter ? audioMeterDbToUnit(meter.rmsDb) : 0);
  const phaseCorrelation = meter && Number.isFinite(meter.phaseCorrelation) ? meter.phaseCorrelation : undefined;
  const phaseUnit = phaseCorrelation !== undefined ? clampUnit((phaseCorrelation + 1) / 2) : 0.5;
  const vertical = orientation === 'vertical';
  const fillTransitionProperties = vertical ? ['clip-path'] : ['transform'];

  if (peakFill) {
    updateMeterTransition(peakFill, peak, fillTransitionProperties);
    peakFill.style.transform = meterFillTransform(peak, orientation);
    peakFill.style.clipPath = meterFillClipPath(peak, orientation) ?? '';
    peakFill.style.opacity = String(hasMeter && peak > 0 ? 0.68 : 0);
  }
  if (rms) {
    updateMeterTransition(rms, rmsUnit, fillTransitionProperties);
    rms.style.transform = meterFillTransform(rmsUnit, orientation);
    rms.style.clipPath = meterFillClipPath(rmsUnit, orientation) ?? '';
    rms.style.opacity = String(hasMeter && rmsUnit > 0 ? 0.9 : 0);
  }
  if (peakMarker) {
    updateMeterTransition(peakMarker, peak, [vertical ? 'bottom' : 'left']);
    if (vertical) {
      peakMarker.style.bottom = `${peak * 100}%`;
      peakMarker.style.transform = 'translateY(50%)';
    } else {
      peakMarker.style.left = `${peak * 100}%`;
      peakMarker.style.transform = 'translateX(-50%)';
    }
    peakMarker.style.opacity = String(hasMeter && peak > 0 ? 1 : 0);
  }
  if (phase) {
    updateMeterTransition(phase, phaseCorrelation !== undefined ? phaseUnit : 0, [vertical ? 'bottom' : 'left']);
    if (vertical) {
      phase.style.bottom = `${phaseUnit * 100}%`;
      phase.style.transform = 'translateY(50%)';
    } else {
      phase.style.left = `${phaseUnit * 100}%`;
      phase.style.transform = 'translateX(-50%)';
    }
    phase.style.opacity = String(phaseCorrelation !== undefined ? 0.95 : 0);
  }
}

interface StereoChannelRefs {
  peakFill: HTMLElement | null;
  rms: HTMLElement | null;
  peakMarker: HTMLElement | null;
}

function applyStereoChannelStyles(
  elements: StereoChannelRefs,
  peakUnit: number,
  rmsUnit: number,
  hasMeter: boolean,
  orientation: 'horizontal' | 'vertical',
): void {
  const vertical = orientation === 'vertical';
  const fillTransitionProperties = vertical ? ['clip-path'] : ['transform'];
  if (elements.peakFill) {
    updateMeterTransition(elements.peakFill, peakUnit, fillTransitionProperties);
    elements.peakFill.style.transform = meterFillTransform(peakUnit, orientation);
    elements.peakFill.style.clipPath = meterFillClipPath(peakUnit, orientation) ?? '';
    elements.peakFill.style.opacity = String(hasMeter && peakUnit > 0 ? 0.68 : 0);
  }
  if (elements.rms) {
    updateMeterTransition(elements.rms, rmsUnit, fillTransitionProperties);
    elements.rms.style.transform = meterFillTransform(rmsUnit, orientation);
    elements.rms.style.clipPath = meterFillClipPath(rmsUnit, orientation) ?? '';
    elements.rms.style.opacity = String(hasMeter && rmsUnit > 0 ? 0.52 : 0);
  }
  if (elements.peakMarker) {
    updateMeterTransition(elements.peakMarker, peakUnit, [vertical ? 'bottom' : 'left']);
    if (vertical) {
      elements.peakMarker.style.bottom = `${peakUnit * 100}%`;
      elements.peakMarker.style.transform = 'translateY(50%)';
    } else {
      elements.peakMarker.style.left = `${peakUnit * 100}%`;
      elements.peakMarker.style.transform = 'translateX(-50%)';
    }
    elements.peakMarker.style.opacity = String(hasMeter && peakUnit > 0 ? 1 : 0);
  }
}

function StreamingAudioLevelMeter({
  streamScope,
  streamFeatures,
  label,
  className = '',
  orientation = 'horizontal',
  display = 'mono',
}: AudioLevelMeterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const peakFillRef = useRef<HTMLDivElement | null>(null);
  const rmsRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<HTMLDivElement | null>(null);
  const leftPeakFillRef = useRef<HTMLDivElement | null>(null);
  const leftRmsRef = useRef<HTMLDivElement | null>(null);
  const leftPeakRef = useRef<HTMLDivElement | null>(null);
  const rightPeakFillRef = useRef<HTMLDivElement | null>(null);
  const rightRmsRef = useRef<HTMLDivElement | null>(null);
  const rightPeakRef = useRef<HTMLDivElement | null>(null);
  const latestMeterRef = useRef<AudioMeterSnapshot | undefined>(undefined);

  // Keep structure stable while the bars animate through refs. Dynamic readouts
  // are rendered separately; this hot path must not trigger React commits.
  const slowFeatures = streamFeatures ?? (display === 'stereo' ? (['level', 'stereo', 'phase'] as const) : (['level'] as const));
  const resolvedDisplay = display === 'auto'
    ? (slowFeatures.includes('stereo') ? 'stereo' : 'mono')
    : display;

  const applyStyles = useCallback((meter: AudioMeterSnapshot | undefined) => {
    latestMeterRef.current = meter;

    const root = rootRef.current;
    if (root) root.classList.toggle('clipping', Boolean(meter?.clipping));

    if (resolvedDisplay === 'stereo') {
      const hasMeter = Boolean(meter);
      const leftPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.peakDb ?? meter.peakDb) : 0);
      const leftRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.left.rmsDb ?? meter.rmsDb) : 0);
      const rightPeak = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.peakDb ?? meter.peakDb) : 0);
      const rightRms = clampUnit(meter ? audioMeterDbToUnit(meter.channels?.right.rmsDb ?? meter.rmsDb) : 0);
      applyStereoChannelStyles(
        { peakFill: leftPeakFillRef.current, rms: leftRmsRef.current, peakMarker: leftPeakRef.current },
        leftPeak,
        leftRms,
        hasMeter,
        orientation,
      );
      applyStereoChannelStyles(
        { peakFill: rightPeakFillRef.current, rms: rightRmsRef.current, peakMarker: rightPeakRef.current },
        rightPeak,
        rightRms,
        hasMeter,
        orientation,
      );
      return;
    }

    applyMonoMeterStyles(peakFillRef.current, rmsRef.current, peakRef.current, phaseRef.current, meter, orientation);
  }, [orientation, resolvedDisplay]);

  useRuntimeAudioMeterFrame(streamScope, applyStyles, { features: slowFeatures });

  // Re-apply the latest snapshot when the rendered structure changes (mono<->stereo,
  // orientation) so the freshly mounted elements are styled before the next publish.
  useEffect(() => {
    applyStyles(latestMeterRef.current);
  }, [applyStyles]);

  const title = `${label}: live signal`;

  if (resolvedDisplay === 'stereo') {
    return (
      <div
        ref={rootRef}
        className={`audio-level-meter stereo ${orientation} ${className}`.trim()}
        role="meter"
        aria-label={label}
        aria-valuemin={AUDIO_METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={AUDIO_METER_FLOOR_DB}
        title={title}
      >
        <div className="audio-level-meter-stereo-channel left">
          <div className="audio-level-meter-scale" />
          <div ref={leftPeakFillRef} className="audio-level-meter-peak-fill" style={{ opacity: 0 }} />
          <div ref={leftRmsRef} className="audio-level-meter-rms" style={{ opacity: 0 }} />
          <div ref={leftPeakRef} className="audio-level-meter-peak" style={{ opacity: 0 }} />
        </div>
        <div className="audio-level-meter-stereo-channel right">
          <div className="audio-level-meter-scale" />
          <div ref={rightPeakFillRef} className="audio-level-meter-peak-fill" style={{ opacity: 0 }} />
          <div ref={rightRmsRef} className="audio-level-meter-rms" style={{ opacity: 0 }} />
          <div ref={rightPeakRef} className="audio-level-meter-peak" style={{ opacity: 0 }} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`audio-level-meter ${orientation} ${className}`.trim()}
      role="meter"
      aria-label={label}
      aria-valuemin={AUDIO_METER_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={AUDIO_METER_FLOOR_DB}
      title={title}
    >
      <div className="audio-level-meter-scale" />
      <div ref={peakFillRef} className="audio-level-meter-peak-fill" style={{ opacity: 0 }} />
    </div>
  );
}

export function AudioLevelMeter(props: AudioLevelMeterProps) {
  if (props.streamScope) {
    return <StreamingAudioLevelMeter {...props} />;
  }
  return <StaticAudioLevelMeter {...props} />;
}
