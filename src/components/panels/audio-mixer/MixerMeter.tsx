import { useRuntimeAudioMeterSnapshot } from '../../../services/audio/runtimeAudioMeterHooks';
import type { RuntimeAudioMeterFeature, RuntimeAudioMeterScope } from '../../../services/audio/runtimeAudioMeterBus';
import type { AudioMeterSnapshot } from '../../../types/audio';
import { formatDbLong } from './audioMixerMath';
import type { FxWindowTarget } from './audioMixerTypes';

// Mixer strips render many meters at once. Keep the default strip path on the
// cheap level analyser; detailed panels opt into stereo/phase when needed.
export const MIXER_METER_VISUAL_FEATURES = ['level'] as const;
export const MIXER_METER_READOUT_FEATURES = ['level'] as const;
export const MIXER_METER_DYNAMICS_FEATURES = ['dynamics'] as const;

const MIXER_METER_READOUT_MAX_FPS = 4;

export function getMixerRuntimeAudioMeterScope(
  scope: FxWindowTarget['scope'] | undefined,
  trackId?: string,
): RuntimeAudioMeterScope | undefined {
  return scope === 'track' && trackId
    ? { kind: 'track', trackId }
    : scope === 'master'
      ? { kind: 'master' }
      : undefined;
}

export function useMixerRuntimeAudioMeter(
  scope: FxWindowTarget['scope'] | undefined,
  trackId?: string,
  features: readonly RuntimeAudioMeterFeature[] = MIXER_METER_READOUT_FEATURES,
): AudioMeterSnapshot | undefined {
  const busScope = getMixerRuntimeAudioMeterScope(scope, trackId);
  return useRuntimeAudioMeterSnapshot(busScope, {
    features,
    maxFps: MIXER_METER_READOUT_MAX_FPS,
  });
}

export function MixerMeterScale() {
  return (
    <div className="audio-mixer-meter-scale-labels" aria-hidden="true">
      <span>+3</span>
      <span>0</span>
      <span>-5</span>
      <span>-10</span>
      <span>-18</span>
      <span>-30</span>
      <span>-50</span>
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
