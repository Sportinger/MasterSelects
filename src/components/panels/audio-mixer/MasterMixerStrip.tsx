import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { MasterAudioState } from '../../../types/audio';
import { AudioLevelMeter } from '../../timeline/components/AudioLevelMeter';
import type { FxWindowTarget } from './audioMixerTypes';
import { formatDb, formatDbLong, getPreflightStatus } from './audioMixerMath';
import {
  getMixerRuntimeAudioMeterScope,
  MixerMeterScale,
  MIXER_METER_VISUAL_FEATURES,
  useMixerRuntimeAudioMeter,
} from './MixerMeter';
import { MixerRack, stopPropagation } from './MixerRack';

type MixerCssProperties = CSSProperties & {
  '--strip-color'?: string;
};

function MasterMixerStripComponent({
  masterAudio,
  focused,
  preflightMeasuring,
  onFocus,
  onOpenFx,
  onStaticPreflight,
  onRenderedPreflight,
}: {
  masterAudio: MasterAudioState;
  focused: boolean;
  preflightMeasuring: boolean;
  onFocus: () => void;
  onOpenFx: (target: FxWindowTarget) => void;
  onStaticPreflight: () => void;
  onRenderedPreflight: () => void;
}) {
  const meterScope = getMixerRuntimeAudioMeterScope('master');
  const meter = useMixerRuntimeAudioMeter('master');
  const status = getPreflightStatus(masterAudio.exportPreflight);
  const measurement = masterAudio.exportPreflight?.measurement;
  const effects = masterAudio.effectStack ?? [];
  const stripStyle: MixerCssProperties = { '--strip-color': '#4a9eff' };
  const resetMasterVolume = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setMasterAudioVolumeDb(0);
  };

  return (
    <section
      className={`audio-mixer-strip master ${focused ? 'focused' : ''} ${masterAudio.limiterEnabled ? 'limited' : ''}`}
      style={stripStyle}
      onClick={onFocus}
    >
      <div className="audio-mixer-strip-color" aria-hidden="true" />

      <div className="audio-mixer-strip-name">
        <strong>Master</strong>
        <span>bus</span>
      </div>

      <MixerRack
        effects={effects}
        sends={[]}
        onOpenEffect={(effectId) => {
          onFocus();
          onOpenFx({ scope: 'master', effectId });
        }}
      />

      <div className="audio-mixer-master-readout">
        <span>LUFS {measurement?.integratedLufs?.toFixed(1) ?? (masterAudio.targetLufs ?? -14).toFixed(1)}</span>
        <span>TP {measurement?.truePeakDbtp?.toFixed(1) ?? masterAudio.truePeakCeilingDb.toFixed(1)}</span>
        <em className={status.className}>{status.label}</em>
      </div>

      <label className="audio-mixer-limiter-row" onPointerDown={stopPropagation}>
        <input
          type="checkbox"
          checked={masterAudio.limiterEnabled}
          onChange={(event) => useTimelineStore.getState().setMasterLimiterEnabled(event.currentTarget.checked)}
        />
        <span>Limiter</span>
      </label>

      <div className="audio-mixer-preflight-actions compact" onPointerDown={stopPropagation}>
        <button type="button" onClick={onStaticPreflight}>Check</button>
        <button type="button" onClick={onRenderedPreflight} disabled={preflightMeasuring}>
          {preflightMeasuring ? 'Measuring' : 'Measure'}
        </button>
      </div>

      <div className="audio-mixer-value-row">
        <span>{formatDb(masterAudio.volumeDb)}</span>
        <span>TP {masterAudio.truePeakCeilingDb.toFixed(1)}</span>
      </div>

      <div className="audio-mixer-fader-meter master" onPointerDown={stopPropagation}>
        <input
          className="audio-mixer-strip-fader"
          type="range"
          min="-60"
          max="18"
          step="0.5"
          value={masterAudio.volumeDb}
          aria-label="Master volume"
          title="Double-click to reset volume to 0 dB"
          onChange={(event) => useTimelineStore.getState().setMasterAudioVolumeDb(Number(event.currentTarget.value))}
          onDoubleClick={resetMasterVolume}
        />
        <AudioLevelMeter
          streamScope={meterScope}
          streamFeatures={MIXER_METER_VISUAL_FEATURES}
          label="Master level"
          className="audio-mixer-meter"
          orientation="vertical"
          display="stereo"
        />
        <MixerMeterScale />
      </div>

      <div className="audio-mixer-strip-output">
        <span>Master</span>
        <strong>{meter ? formatDbLong(meter.peakDb) : '-inf'}</strong>
      </div>
    </section>
  );
}

export const MasterMixerStrip = memo(MasterMixerStripComponent, (prev, next) => (
  prev.masterAudio === next.masterAudio
  && prev.focused === next.focused
  && prev.preflightMeasuring === next.preflightMeasuring
  && prev.onOpenFx === next.onOpenFx
  && prev.onStaticPreflight === next.onStaticPreflight
  && prev.onRenderedPreflight === next.onRenderedPreflight
));
