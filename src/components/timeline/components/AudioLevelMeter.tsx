import type { AudioMeterSnapshot } from '../../../types';
import { AUDIO_METER_FLOOR_DB, audioMeterDbToUnit } from '../../../services/audio/audioMetering';

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

export function AudioLevelMeter({
  meter,
  label,
  className = '',
  orientation = 'horizontal',
}: AudioLevelMeterProps) {
  const peak = meter ? audioMeterDbToUnit(meter.peakDb) : 0;
  const rms = meter ? audioMeterDbToUnit(meter.rmsDb) : 0;
  const rmsTransform = orientation === 'vertical' ? `scaleY(${rms})` : `scaleX(${rms})`;
  const peakStyle = orientation === 'vertical'
    ? {
        bottom: `${Math.max(0, Math.min(1, peak)) * 100}%`,
        transform: 'translateY(50%)',
      }
    : {
        left: `${Math.max(0, Math.min(1, peak)) * 100}%`,
        transform: 'translateX(-50%)',
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
      <div className="audio-level-meter-rms" style={{ transform: rmsTransform }} />
      <div className="audio-level-meter-peak" style={peakStyle} />
    </div>
  );
}
