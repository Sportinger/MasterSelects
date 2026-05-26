// Volume Tab - Audio volume and EQ controls
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types';
import { EQ_FREQUENCIES } from '../../../services/audioManager';
import { DraggableNumber, EffectKeyframeToggle, EQKeyframeToggle } from './shared';
import { EQ_BAND_PARAMS } from './sharedConstants';
import { MIDIParameterLabel } from './MIDIParameterLabel';
import { AudioEffectStackControl } from './AudioEffectStackControl';
import { GraphicalEqualizerControl } from './GraphicalEqualizerControl';
import { formatEqualizerFrequency } from './equalizerFormatting';

// dB conversion helpers (internal gain 0–2 ↔ display dB)
const SILENCE_THRESHOLD_DB = -60;
const gainToDb = (gain: number): number => gain <= 0 ? SILENCE_THRESHOLD_DB : Math.max(SILENCE_THRESHOLD_DB, 20 * Math.log10(gain));
const dbToGain = (db: number): number => db <= SILENCE_THRESHOLD_DB ? 0 : Math.pow(10, db / 20);
const LEGACY_VOLUME_EQ_EFFECT_IDS = new Set(['audio-volume', 'audio-eq']);
type LegacyAudioEffectType = 'audio-volume' | 'audio-eq';

interface VolumeTabProps {
  clipId: string;
  effects: Array<{ id: string; name: string; type: string; params: Record<string, number | boolean | string> }>;
}

export function VolumeTab({ clipId, effects }: VolumeTabProps) {
  // Reactive data - subscribe to specific values only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clips = useTimelineStore(state => state.clips);
  const runtimeDynamics = useTimelineStore(state => {
    const currentClip = state.clips.find(candidate => candidate.id === clipId);
    return currentClip
      ? state.runtimeAudioMeters.trackMeters[currentClip.trackId]?.dynamics
      : undefined;
  });
  // Actions from getState() - stable, no subscription needed
  const {
    setPropertyValue,
    getInterpolatedEffects,
    addClipEffect,
    setClipPreservesPitch,
    addClipAudioEffectInstance,
    updateClipAudioEffectInstance,
    setClipAudioEffectInstanceEnabled,
    removeClipAudioEffectInstance,
    reorderClipAudioEffectInstance,
  } = useTimelineStore.getState();
  const clip = clips.find(c => c.id === clipId);
  const clipLocalTime = clip ? playheadPosition - clip.startTime : 0;
  const interpolatedEffects = getInterpolatedEffects(clipId, clipLocalTime);
  const preservesPitch = clip?.preservesPitch !== false; // default true
  const clipAudioEffectStack = clip?.audioState?.effectStack ?? [];

  const getOrCreateLegacyAudioEffectId = (effectType: LegacyAudioEffectType): string => {
    const currentClip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    const currentEffect = currentClip?.effects.find(effect => effect.type === effectType);
    return currentEffect?.id ?? addClipEffect(clipId, effectType);
  };

  // Get current values
  const actualVolumeEffect = effects.find(e => e.type === 'audio-volume');
  const actualEqEffect = effects.find(e => e.type === 'audio-eq');
  const volumeEffect = interpolatedEffects.find(e => e.type === 'audio-volume') ?? actualVolumeEffect;
  const eqEffect = interpolatedEffects.find(e => e.type === 'audio-eq') ?? actualEqEffect;
  const volume = (volumeEffect?.params?.volume as number) ?? 1;
  const eqBands = EQ_BAND_PARAMS.map(param => (eqEffect?.params?.[param] as number) ?? 0);
  const volumeMIDITarget = actualVolumeEffect ? {
    clipId,
    property: createEffectProperty(actualVolumeEffect.id, 'volume'),
    label: 'Volume',
    currentValue: volume,
    min: dbToGain(SILENCE_THRESHOLD_DB),
    max: dbToGain(6),
  } : null;

  const handleVolumeChange = (value: number) => {
    const effectId = getOrCreateLegacyAudioEffectId('audio-volume');
    const property = createEffectProperty(effectId, 'volume');
    setPropertyValue(clipId, property, value);
  };

  const handleEQChange = (bandIndex: number, value: number) => {
    const effectId = getOrCreateLegacyAudioEffectId('audio-eq');
    const property = createEffectProperty(effectId, EQ_BAND_PARAMS[bandIndex]);
    setPropertyValue(clipId, property, value);
  };

  const handleResetEQ = () => {
    const effectId = actualEqEffect?.id;
    if (!effectId) return;
    EQ_BAND_PARAMS.forEach(param => {
      const property = createEffectProperty(effectId, param);
      setPropertyValue(clipId, property, 0);
    });
  };

  const eqGraphBands = EQ_FREQUENCIES.map((freq, index) => {
    const label = formatEqualizerFrequency(freq);
    return {
      id: EQ_BAND_PARAMS[index],
      frequencyHz: freq,
      valueDb: eqBands[index],
      ariaLabel: `${label}Hz EQ`,
      label: (
        <MIDIParameterLabel
          as="span"
          target={actualEqEffect ? {
            clipId,
            property: createEffectProperty(actualEqEffect.id, EQ_BAND_PARAMS[index]),
            label: `${label}Hz EQ`,
            currentValue: eqBands[index],
            min: -12,
            max: 12,
          } : null}
        >
          {label}
        </MIDIParameterLabel>
      ),
    };
  });

  return (
    <div className="properties-tab-content volume-tab">
      {/* Volume Section */}
      <div className="properties-section">
        <div className="section-header-row">
          <h4>
            <MIDIParameterLabel target={volumeMIDITarget}>
              Volume
            </MIDIParameterLabel>
          </h4>
        </div>
        <div className="control-row">
          {volumeEffect && (
            <EffectKeyframeToggle clipId={clipId} effectId={volumeEffect.id} paramName="volume" value={volume} />
          )}
          <DraggableNumber
            value={gainToDb(volume)}
            onChange={(db) => handleVolumeChange(dbToGain(db))}
            defaultValue={0}
            min={SILENCE_THRESHOLD_DB}
            max={6}
            decimals={1}
            suffix=" dB"
            sensitivity={4}
          />
        </div>
      </div>

      {/* Pitch Preservation Section */}
      <div className="properties-section">
        <div className="section-header-row">
          <h4>Speed Settings</h4>
        </div>
        <div className="control-row checkbox-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preservesPitch}
              onChange={(e) => setClipPreservesPitch(clipId, e.target.checked)}
            />
            <span>Keep Pitch</span>
          </label>
          <span className="hint">When speed changes, maintain original pitch</span>
        </div>
      </div>

      {/* 10-Band EQ Section */}
      <div className="properties-section eq-section">
        <div className="section-header-row">
          <h4>10-Band Equalizer</h4>
          {actualEqEffect && (
            <EQKeyframeToggle clipId={clipId} effectId={actualEqEffect.id} eqBands={eqBands} />
          )}
          <button className="btn btn-sm" onClick={handleResetEQ}>Reset</button>
        </div>

        <GraphicalEqualizerControl
          bands={eqGraphBands}
          minDb={-12}
          maxDb={12}
          step={0.5}
          ariaLabel="10-band clip equalizer"
          onChange={handleEQChange}
          onResetBand={(bandIndex) => handleEQChange(bandIndex, 0)}
        />
      </div>

      {/* Registry Audio Effects Section */}
      <div className="properties-section audio-effect-stack-section">
        <AudioEffectStackControl
          effects={clipAudioEffectStack}
          excludeDescriptorIds={LEGACY_VOLUME_EQ_EFFECT_IDS}
          keyframeClipId={clipId}
          runtimeDynamics={runtimeDynamics}
          onAddEffect={(descriptorId) => addClipAudioEffectInstance(clipId, descriptorId)}
          onUpdateEffect={(effect, paramName, value) => updateClipAudioEffectInstance(clipId, effect.id, { [paramName]: value })}
          onSetEffectEnabled={(effectId, enabled) => setClipAudioEffectInstanceEnabled(clipId, effectId, enabled)}
          onRemoveEffect={(effectId) => removeClipAudioEffectInstance(clipId, effectId)}
          onReorderEffect={(effectId, newIndex) => reorderClipAudioEffectInstance(clipId, effectId, newIndex)}
        />
      </div>
    </div>
  );
}
