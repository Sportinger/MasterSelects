import type { AudioMeterSnapshot } from '../../../types';
import { AUDIO_METER_FLOOR_DB, audioMeterDbToUnit } from '../../../services/audio/audioMetering';
import type { CSSProperties } from 'react';

interface AudioLevelMeterProps {
  meter?: AudioMeterSnapshot;
  label: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

function formatDb(value: number): string {
  if (value <= AUDIO_METER_FLOOR_DB + 0.5) return '-inf dB';
  return `${value.toFixed(1)} dB`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function AudioLevelMeter({
  meter,
  label,
  className = '',
  orientation = 'horizontal',
}: AudioLevelMeterProps) {
  const peak = clampUnit(meter ? audioMeterDbToUnit(meter.peakDb) : 0);
  const rms = clampUnit(meter ? audioMeterDbToUnit(meter.rmsDb) : 0);
  const peakTransform = orientation === 'vertical' ? `scaleY(${peak})` : `scaleX(${peak})`;
  const rmsTransform = orientation === 'vertical' ? `scaleY(${rms})` : `scaleX(${rms})`;
  const peakFillStyle = {
    transform: peakTransform,
    opacity: meter && peak > 0 ? 0.68 : 0,
  } as CSSProperties;
  const rmsStyle = {
    transform: rmsTransform,
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
  const title = meter
    ? `${label}: peak ${formatDb(meter.peakDb)}, rms ${formatDb(meter.rmsDb)}`
    : `${label}: no live signal`;

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
      <div className="audio-level-meter-peak" style={peakStyle} />
    </div>
  );
}
