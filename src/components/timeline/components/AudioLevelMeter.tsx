import type { AudioMeterSnapshot } from '../../../types';
import { AUDIO_METER_FLOOR_DB, audioMeterDbToUnit } from '../../../services/audio/audioMetering';
import type { CSSProperties } from 'react';

interface AudioLevelMeterProps {
  meter?: AudioMeterSnapshot;
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

export function AudioLevelMeter({
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
  const stereoWidth = meter && Number.isFinite(meter.stereoWidth) ? meter.stereoWidth : undefined;
  const phaseUnit = phaseCorrelation !== undefined ? clampUnit((phaseCorrelation + 1) / 2) : 0.5;
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
  const title = meter
    ? `${label}: peak ${formatDb(meter.peakDb)}, rms ${formatDb(meter.rmsDb)}${
        resolvedDisplay === 'stereo' && meter.channels
          ? `, L ${formatDb(meter.channels.left.peakDb)}, R ${formatDb(meter.channels.right.peakDb)}`
          : ''
      }${
        phaseCorrelation !== undefined ? `, phase ${formatUnit(phaseCorrelation)}` : ''
      }${stereoWidth !== undefined ? `, width ${formatUnit(stereoWidth)}` : ''}`
    : `${label}: no live signal`;
  const stereoBarStyle = (peakUnit: number, rmsUnit: number) => ({
    '--meter-peak-top': `${(1 - peakUnit) * 100}%`,
    '--meter-peak-right': `${(1 - peakUnit) * 100}%`,
    '--meter-rms-top': `${(1 - rmsUnit) * 100}%`,
    '--meter-peak-pos': `${peakUnit * 100}%`,
    '--meter-rms-pos': `${rmsUnit * 100}%`,
    '--meter-active': meter && peakUnit > 0 ? 1 : 0,
    '--meter-rms-active': meter && rmsUnit > 0 ? 1 : 0,
  }) as CSSProperties;

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
        <div className="audio-level-meter-stereo-channel left" style={stereoBarStyle(leftPeak, leftRms)}>
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
        </div>
        <div className="audio-level-meter-stereo-channel right" style={stereoBarStyle(rightPeak, rightRms)}>
          <div className="audio-level-meter-scale" />
          <div className="audio-level-meter-peak-fill" />
          <div className="audio-level-meter-rms" />
          <div className="audio-level-meter-peak" />
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
