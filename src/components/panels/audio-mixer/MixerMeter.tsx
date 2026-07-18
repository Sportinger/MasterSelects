import { formatDbLong, getMixerFaderScaleTopPercent } from './audioMixerMath';
import type { FxWindowTarget } from './audioMixerTypes';
import { useMixerRuntimeAudioMeter } from './mixerMeterRuntime';

const MIXER_FADER_SCALE_VALUES_DB = [18, 12, 6, 0, -12, -30, -60] as const;

function formatFaderScaleLabel(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function MixerMeterScale() {
  return (
    <div className="audio-mixer-meter-scale-labels" aria-hidden="true">
      <div className="audio-mixer-meter-scale-label-inner">
        {MIXER_FADER_SCALE_VALUES_DB.map(value => (
          <span
            key={value}
            style={{ top: `${getMixerFaderScaleTopPercent(value)}%` }}
          >
            {formatFaderScaleLabel(value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MixerMeterReadout({
  scope,
  trackId,
}: {
  scope: FxWindowTarget['scope'];
  trackId?: string;
}) {
  const meter = useMixerRuntimeAudioMeter(scope, trackId);
  return <strong>{meter ? formatDbLong(meter.peakDb) : '-inf'}</strong>;
}
