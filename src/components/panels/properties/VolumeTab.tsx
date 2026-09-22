import { useAudioBuiltinCardOrder } from './useAudioBuiltinCardOrder';
import { isVideoInspectorSectionEnabled } from '../../../services/videoInspector/sectionBypass';
import { EffectCard } from './EffectCard';
// Volume Tab - Audio volume and EQ controls
import { useTimelineStore } from '../../../stores/timeline';
import {
  createEffectProperty,
  type AnimatableProperty,
} from '../../../types/animationProperties';
import type {
  AudioEffectInstance,
  AudioEffectParamValue,
} from '../../../types/audio';
import type { Keyframe } from '../../../types/keyframes';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { EffectKeyframeToggle, KeyframeToggle, MultiKeyframeToggle } from './shared';
import { MIDIParameterLabel } from './MIDIParameterLabel';
import { ResolveInspectorRow, ResolveInspectorIconButton, ResolveResetIcon } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { AudioEffectStackControl } from './AudioEffectStackControl';
import { LegacyClipAudioEffects } from './LegacyClipAudioEffects';
import { FlexEqualizerControl } from './FlexEqualizerControl';
import { useRuntimeAudioMeterSnapshot } from '../../../services/audio/runtimeAudioMeterHooks';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
  createDefaultAudioEqParams,
} from '../../../engine/audio/eq/AudioEqDefaults';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import type { AudioEqParamsV2 } from '../../../engine/audio/eq/AudioEqTypes';
import {
  getAudioEffectParamPathValue,
  mergeAudioEffectParamPatch,
} from '../../../utils/audioEffectParamPath';
import { getAudioEqAllNumericKeyframeEntries } from './audioEqKeyframes';
import { endBatch, startBatch } from '../../../stores/historyStore';
import {
  CLIP_SPEED_MAX_PERCENT,
  CLIP_SPEED_MIN_PERCENT,
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
} from '../../../stores/timeline/helpers/linkedClipSpeed';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';

// dB conversion helpers (linear gain to/from display dB)
const SILENCE_THRESHOLD_DB = -60;
const gainToDb = (gain: number): number => gain <= 0 ? SILENCE_THRESHOLD_DB : Math.max(SILENCE_THRESHOLD_DB, 20 * Math.log10(gain));
const dbToGain = (db: number): number => db <= SILENCE_THRESHOLD_DB ? 0 : Math.pow(10, db / 20);
const LEGACY_VOLUME_EFFECT_IDS = new Set(['audio-volume']);
const EMPTY_KEYFRAMES: readonly Keyframe[] = [];
type LegacyAudioEffectType = 'audio-volume' | 'audio-eq';

interface VolumeTabProps {
  clipId: string;
  effects: Array<{ id: string; name: string; type: string; enabled?: boolean; params: Record<string, AudioEffectParamValue> }>;
}

function parseEffectKeyframeProperty(property: AnimatableProperty): { effectId: string; paramName: string } | null {
  const parts = property.split('.');
  if (parts.length < 3 || parts[0] !== 'effect') return null;
  return { effectId: parts[1], paramName: parts.slice(2).join('.') };
}

function getDefaultAudioEqNumericPathValue(path: readonly string[]): number | undefined {
  const [audible, bands, bandId, scope, paramName] = path;
  if (audible !== 'audible' || bands !== 'bands' || !bandId || !scope || !paramName) {
    return undefined;
  }

  if (scope === 'dynamic') {
    const value = AUDIO_EQ_DEFAULT_BAND_DYNAMICS[paramName as keyof typeof AUDIO_EQ_DEFAULT_BAND_DYNAMICS];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  if (scope === 'spectralDynamics') {
    const value = AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS[paramName as keyof typeof AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  return undefined;
}

function getAudioEffectInstanceKeyframeBaseValue(
  effect: AudioEffectInstance,
  paramName: string,
): number | undefined {
  if (!paramName.includes('.')) {
    const value = effect.params[paramName];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  const path = paramName.split('.').filter(Boolean);
  if (path.length === 0) return undefined;

  const value = effect.descriptorId === 'audio-eq' && path[0] === 'eq'
    ? getAudioEffectParamPathValue(
        normalizeAudioEqParams(effect.params) as unknown as AudioEffectParamValue,
        path.slice(1),
      )
    : getAudioEffectParamPathValue(effect.params, path);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return effect.descriptorId === 'audio-eq' && path[0] === 'eq'
    ? getDefaultAudioEqNumericPathValue(path.slice(1))
    : undefined;
}

function interpolateAudioEffectStack(
  effects: readonly AudioEffectInstance[],
  keyframes: readonly Keyframe[],
  clipLocalTime: number,
): AudioEffectInstance[] {
  const effectKeyframes = keyframes.filter(keyframe => keyframe.property.startsWith('effect.'));
  if (effectKeyframes.length === 0) {
    return [...effects];
  }

  return effects.map(effect => {
    let params = { ...effect.params };
    const paramNames = new Set<string>();

    Object.entries(effect.params).forEach(([paramName, value]) => {
      if (typeof value === 'number') {
        paramNames.add(paramName);
      }
    });

    effectKeyframes.forEach(keyframe => {
      const parsed = parseEffectKeyframeProperty(keyframe.property);
      if (parsed?.effectId === effect.id) {
        paramNames.add(parsed.paramName);
      }
    });

    paramNames.forEach(paramName => {
      const propertyKey = `effect.${effect.id}.${paramName}` as AnimatableProperty;
      if (!effectKeyframes.some(keyframe => keyframe.property === propertyKey)) {
        return;
      }

      const baseValue = getAudioEffectInstanceKeyframeBaseValue(effect, paramName);
      if (baseValue === undefined) {
        return;
      }

      params = mergeAudioEffectParamPatch(
        params,
        {
          [paramName]: interpolateKeyframes(
            [...keyframes],
            propertyKey,
            clipLocalTime,
            baseValue,
          ),
        },
        effect.descriptorId,
      );
    });

    return { ...effect, params };
  });
}

export function VolumeTab({ clipId, effects }: VolumeTabProps) {
  const builtinCardProps = useAudioBuiltinCardOrder();
  // Reactive data - subscribe to specific values only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clips = useTimelineStore(state => state.clips);
  const clip = clips.find(candidate => candidate.id === clipId);
  const linkedSpeedPair = resolveLinkedVideoAudioPair(clips, clipId);
  const followsLinkedVideoSpeed = Boolean(
    linkedSpeedPair?.audio.id === clipId && isLinkedAudioFollowingVideo(linkedSpeedPair),
  );
  const speedOwner = followsLinkedVideoSpeed ? linkedSpeedPair!.video : clip;
  const trackId = clip?.trackId;
  const runtimeDynamicsMeter = useRuntimeAudioMeterSnapshot(
    trackId ? { kind: 'track', trackId } : undefined,
    { features: ['dynamics'], maxFps: 30 },
  );
  const runtimeDynamics = runtimeDynamicsMeter?.dynamics;
  const keyframeStateToken = useTimelineStore(state => {
    const keyframes = state.clipKeyframes.get(clipId) ?? [];
    const recordingKeys = Array.from(state.keyframeRecordingEnabled)
      .filter(key => key.startsWith(`${clipId}:`))
      .toSorted()
      .join('|');
    return `${recordingKeys}::${keyframes.map(keyframe => (
      `${keyframe.id}:${keyframe.time}:${keyframe.property}:${keyframe.value}`
    )).join('|')}`;
  });
  // Actions from getState() - stable, no subscription needed
  const {
    setPropertyValue,
    setClipSpeed,
    setLinkedClipSpeedEnabled,
    getInterpolatedSpeed,
    getInterpolatedEffects,
    addClipEffect,
    removeClipEffect,
    setClipEffectEnabled,
    updateClipEffect,
    setClipPreservesPitch,
    addClipAudioEffectInstance,
    updateClipAudioEffectInstance,
    setClipAudioEffectInstanceEnabled,
    removeClipAudioEffectInstance,
    reorderClipAudioEffectInstance,
  } = useTimelineStore.getState();
  const clipLocalTime = clip ? playheadPosition - clip.startTime : 0;
  const speedLocalTime = speedOwner ? playheadPosition - speedOwner.startTime : 0;
  void keyframeStateToken;
  const interpolatedEffects = getInterpolatedEffects(clipId, clipLocalTime);
  const preservesPitch = clip?.preservesPitch !== false; // default true
  const speed = speedOwner ? getInterpolatedSpeed(speedOwner.id, speedLocalTime) : 1;
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES);
  const clipAudioEffectStack = interpolateAudioEffectStack(
    clip?.audioState?.effectStack ?? [],
    clipKeyframes,
    clipLocalTime,
  );
  const clipEffects: VolumeTabProps['effects'] = (clip?.effects as VolumeTabProps['effects'] | undefined) ?? effects;

  const getOrCreateLegacyAudioEffectId = (effectType: LegacyAudioEffectType): string => {
    const currentClip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    const currentEffect = currentClip?.effects.find(effect => effect.type === effectType);
    return currentEffect?.id ?? addClipEffect(clipId, effectType);
  };

  // Get current values
  const actualVolumeEffect = clipEffects.find(e => e.type === 'audio-volume');
  const actualEqEffect = clipEffects.find(e => e.type === 'audio-eq');
  const volumeEffect = interpolatedEffects.find(e => e.type === 'audio-volume') ?? actualVolumeEffect;
  const eqEffect = interpolatedEffects.find(e => e.type === 'audio-eq') ?? actualEqEffect;
  const volume = (volumeEffect?.params?.volume as number) ?? 1;
  const eqParams = eqEffect?.params ?? actualEqEffect?.params ?? {};
  const normalizedEqParams = normalizeAudioEqParams(eqParams);
  const eqAllKeyframeEntries = actualEqEffect
    ? getAudioEqAllNumericKeyframeEntries(actualEqEffect.id, normalizedEqParams.audible.bands)
    : [];
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

  const handleResetEQ = () => {
    const effectId = getOrCreateLegacyAudioEffectId('audio-eq');
    updateClipEffect(clipId, effectId, { eq: createDefaultAudioEqParams() as unknown as AudioEffectParamValue });
  };

  const handleEQPathChange = (path: string, value: AudioEffectParamValue) => {
    const effectId = getOrCreateLegacyAudioEffectId('audio-eq');
    if (typeof value === 'number' && path.startsWith('eq.audible.')) {
      setPropertyValue(clipId, createEffectProperty(effectId, path), value);
      return;
    }

    updateClipEffect(clipId, effectId, { [path]: value });
  };

  const handleEQParamsChange = (params: AudioEqParamsV2) => {
    const effectId = getOrCreateLegacyAudioEffectId('audio-eq');
    updateClipEffect(clipId, effectId, { eq: params as unknown as AudioEffectParamValue });
  };

  const handleAudioEffectStackUpdate = (
    effect: { id: string },
    paramName: string,
    value: AudioEffectParamValue,
  ) => {
    if (typeof value === 'number') {
      setPropertyValue(clipId, createEffectProperty(effect.id, paramName), value);
      return;
    }

    updateClipAudioEffectInstance(clipId, effect.id, { [paramName]: value });
  };

  const builtInControls = (<>
      <div className="audio-builtin-cards">
      <EffectCard title="Volume" {...builtinCardProps('volume')} enabled={actualVolumeEffect?.enabled !== false}
        onEnabledChange={enabled => setClipEffectEnabled(clipId, getOrCreateLegacyAudioEffectId('audio-volume'), enabled)}>
        <ResolveInspectorNumberRow label="Level" ariaLabel="Audio volume"
          value={gainToDb(volume)} onChange={(db) => handleVolumeChange(dbToGain(db))}
          defaultValue={0} min={SILENCE_THRESHOLD_DB} max={18} numberMax={64} hardMin={SILENCE_THRESHOLD_DB} hardMax={64}
          step={0.1} decimals={1} suffix=" dB" sensitivity={4}
          persistenceKey={`audio.${clipId}.volume`}
          actions={volumeMIDITarget ? <MIDIParameterLabel target={volumeMIDITarget}>MIDI</MIDIParameterLabel> : undefined}
          keyframeToggle={<EffectKeyframeToggle clipId={clipId} effectId={actualVolumeEffect?.id}
            ensureEffectId={() => getOrCreateLegacyAudioEffectId('audio-volume')} paramName="volume" value={volume} />}
          onDragStart={() => startBatch('Adjust audio volume')} onDragEnd={() => endBatch()}
          onCommit={(method) => trackEditorControlCommitted({
            area: 'audio', controlId: 'volume', controlKind: 'number', inputMethod: method,
            interaction: method === 'reset' ? 'reset' : 'change', itemId: 'volume', itemKind: 'property',
          })}
        />
      </EffectCard>

      <EffectCard title="Speed Settings" {...builtinCardProps('speed')}
        enabled={isVideoInspectorSectionEnabled(clip?.videoInspectorSections, 'speedChange')}
        onEnabledChange={enabled => {
          const state = useTimelineStore.getState();
          const current = state.clips.find(candidate => candidate.id === clipId);
          if (current) state.updateClip(clipId, { videoInspectorSections: { ...current.videoInspectorSections, speedChange: enabled } });
        }}>
        {linkedSpeedPair?.audio.id === clipId && (
          <ResolveInspectorRow label="Follow Video" title="Turn off to edit this audio clip independently">
            <input type="checkbox" aria-label="Follow Linked Video Speed"
              checked={followsLinkedVideoSpeed}
              onChange={(event) => setLinkedClipSpeedEnabled(clipId, event.target.checked)} />
          </ResolveInspectorRow>
        )}
        <ResolveInspectorNumberRow label="Speed" ariaLabel="Audio speed"
          value={speed * 100} onChange={(percent) => setClipSpeed(clipId, percent / 100)}
          defaultValue={100} min={CLIP_SPEED_MIN_PERCENT} max={CLIP_SPEED_MAX_PERCENT}
          hardMin={CLIP_SPEED_MIN_PERCENT} hardMax={CLIP_SPEED_MAX_PERCENT}
          step={1} decimals={0} suffix="%" sensitivity={1} disabled={followsLinkedVideoSpeed}
          persistenceKey={`audio.${clipId}.speed`}
          keyframeToggle={!followsLinkedVideoSpeed ? <KeyframeToggle clipId={clipId} property="speed" value={speed} /> : undefined}
          onDragStart={() => startBatch('Adjust audio speed')} onDragEnd={() => endBatch()}
          onCommit={(method) => trackEditorControlCommitted({
            area: 'audio', controlId: 'speed', controlKind: 'number', inputMethod: method,
            interaction: method === 'reset' ? 'reset' : 'change', itemId: 'speed', itemKind: 'property',
          })}
        />
        {(Math.abs(speed) < 0.25 || Math.abs(speed) > 4) && (
          <div className="control-row">
            <span className="hint">Exact timing is used for export; browser preview is limited outside 25-400%.</span>
          </div>
        )}
        <ResolveInspectorRow label="Keep Pitch" title="When speed changes, maintain original pitch">
          <input type="checkbox" aria-label="Keep Pitch" checked={preservesPitch}
            onChange={(event) => setClipPreservesPitch(clipId, event.target.checked)} />
        </ResolveInspectorRow>
      </EffectCard>

      </div>

      {/* Legacy EQ Section - only shown for older clips that already contain a clip.effects audio-eq. */}
      {actualEqEffect && (
        <EffectCard title="Legacy Equalizer" className="audio-effect-inspector-item" enabled={actualEqEffect.enabled !== false}
          onEnabledChange={(enabled) => setClipEffectEnabled(clipId, actualEqEffect.id, enabled)}
          onRemove={() => removeClipEffect(clipId, actualEqEffect.id)}
          headerActions={<>
            {eqAllKeyframeEntries.length > 0 && <MultiKeyframeToggle clipId={clipId} entries={eqAllKeyframeEntries}
              dragId={`${clipId}:effect:${actualEqEffect.id}:eq-all`} title="Add all EQ parameter keyframes" />}
            <ResolveInspectorIconButton ariaLabel="Reset Legacy Equalizer" onClick={handleResetEQ}><ResolveResetIcon /></ResolveInspectorIconButton>
          </>}>
          <FlexEqualizerControl
            params={eqParams}
            runtimeAnalyzerScope={trackId ? 'track' : undefined}
            runtimeAnalyzerTrackId={trackId}
            ariaLabel="Legacy clip equalizer"
            disabled={actualEqEffect.enabled === false}
            keyframeClipId={clipId}
            effectId={actualEqEffect.id}
            onUpdateParamPath={handleEQPathChange}
            onChangeParams={handleEQParamsChange}
          />
        </EffectCard>
      )}

  </>);

  return (
    <div className="properties-tab-content volume-tab">
      {/* Registry Audio Effects Section */}
      <div className="audio-effect-stack-section">
        <AudioEffectStackControl
          beforeEffects={builtInControls}
          effects={clipAudioEffectStack}
          excludeDescriptorIds={LEGACY_VOLUME_EFFECT_IDS}
          keyframeClipId={clipId}
          runtimeDynamics={runtimeDynamics}
          runtimeAnalyzerScope={trackId ? 'track' : undefined}
          runtimeAnalyzerTrackId={trackId}
          onAddEffect={(descriptorId) => addClipAudioEffectInstance(clipId, descriptorId)}
          onUpdateEffect={handleAudioEffectStackUpdate}
          onSetEffectEnabled={(effectId, enabled) => setClipAudioEffectInstanceEnabled(clipId, effectId, enabled)}
          onRemoveEffect={(effectId) => removeClipAudioEffectInstance(clipId, effectId)}
          onReorderEffect={(effectId, newIndex) => reorderClipAudioEffectInstance(clipId, effectId, newIndex)}
        />
        <LegacyClipAudioEffects clipId={clipId} />
      </div>
    </div>
  );
}
