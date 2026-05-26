import type {
  AudioEffectInstance,
  Effect,
  MasterAudioState,
  TimelineClip,
  TimelineTrack,
} from '../../../types';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import type { AudioEqParamsV2 } from './AudioEqTypes';

export type AudioEqInstanceScope = 'clip' | 'track' | 'master';

export interface AudioEqInstanceDescriptor {
  id: string;
  scope: AudioEqInstanceScope;
  ownerId: string;
  ownerName: string;
  effectId: string;
  enabled: boolean;
  params: AudioEqParamsV2;
  bandCount: number;
  dynamicBandCount: number;
  spectralBandCount: number;
  searchText: string;
}

export interface AudioEqInstanceRegistryInput {
  clips?: readonly TimelineClip[];
  tracks?: readonly TimelineTrack[];
  masterAudioState?: MasterAudioState;
}

export interface AudioEqInstanceRegistryFilter {
  query?: string;
  scope?: AudioEqInstanceScope | 'all';
}

function normalizeEffectEnabled(effect: Pick<AudioEffectInstance, 'enabled'> | Pick<Effect, 'enabled'>): boolean {
  return effect.enabled !== false;
}

function createInstanceDescriptor(input: {
  scope: AudioEqInstanceScope;
  ownerId: string;
  ownerName: string;
  effectId: string;
  enabled: boolean;
  params: unknown;
}): AudioEqInstanceDescriptor {
  const params = normalizeAudioEqParams(input.params);
  const dynamicBandCount = params.audible.bands.filter(band => band.dynamic?.enabled === true).length;
  const spectralBandCount = params.audible.bands.filter(band => band.spectralDynamics?.enabled === true).length;
  const searchText = [
    input.scope,
    input.ownerName,
    input.effectId,
    params.audible.presetKind,
    params.audible.phaseMode,
    params.audible.characterMode,
    ...params.audible.bands.map(band => `${band.type} ${Math.round(band.frequencyHz)} ${band.gainDb}`),
  ].join(' ').toLowerCase();

  return {
    id: `${input.scope}:${input.ownerId}:${input.effectId}`,
    scope: input.scope,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    effectId: input.effectId,
    enabled: input.enabled,
    params,
    bandCount: params.audible.bands.length,
    dynamicBandCount,
    spectralBandCount,
    searchText,
  };
}

function collectClipEqInstances(clips: readonly TimelineClip[] | undefined): AudioEqInstanceDescriptor[] {
  const instances: AudioEqInstanceDescriptor[] = [];
  for (const clip of clips ?? []) {
    for (const effect of clip.audioState?.effectStack ?? []) {
      if (effect.descriptorId !== 'audio-eq') continue;
      instances.push(createInstanceDescriptor({
        scope: 'clip',
        ownerId: clip.id,
        ownerName: clip.name,
        effectId: effect.id,
        enabled: normalizeEffectEnabled(effect),
        params: effect.params,
      }));
    }

    for (const effect of clip.effects ?? []) {
      if (effect.type !== 'audio-eq') continue;
      instances.push(createInstanceDescriptor({
        scope: 'clip',
        ownerId: clip.id,
        ownerName: clip.name,
        effectId: effect.id,
        enabled: normalizeEffectEnabled(effect),
        params: effect.params,
      }));
    }
  }
  return instances;
}

function collectTrackEqInstances(tracks: readonly TimelineTrack[] | undefined): AudioEqInstanceDescriptor[] {
  const instances: AudioEqInstanceDescriptor[] = [];
  for (const track of tracks ?? []) {
    for (const effect of track.audioState?.effectStack ?? []) {
      if (effect.descriptorId !== 'audio-eq') continue;
      instances.push(createInstanceDescriptor({
        scope: 'track',
        ownerId: track.id,
        ownerName: track.name,
        effectId: effect.id,
        enabled: normalizeEffectEnabled(effect),
        params: effect.params,
      }));
    }
  }
  return instances;
}

function collectMasterEqInstances(masterAudioState: MasterAudioState | undefined): AudioEqInstanceDescriptor[] {
  return (masterAudioState?.effectStack ?? [])
    .filter(effect => effect.descriptorId === 'audio-eq')
    .map(effect => createInstanceDescriptor({
      scope: 'master',
      ownerId: 'master',
      ownerName: 'Master',
      effectId: effect.id,
      enabled: normalizeEffectEnabled(effect),
      params: effect.params,
    }));
}

export function collectAudioEqInstances(input: AudioEqInstanceRegistryInput): AudioEqInstanceDescriptor[] {
  return [
    ...collectClipEqInstances(input.clips),
    ...collectTrackEqInstances(input.tracks),
    ...collectMasterEqInstances(input.masterAudioState),
  ].sort((a, b) => {
    const scopeOrder = { clip: 0, track: 1, master: 2 } satisfies Record<AudioEqInstanceScope, number>;
    return scopeOrder[a.scope] - scopeOrder[b.scope] || a.ownerName.localeCompare(b.ownerName) || a.effectId.localeCompare(b.effectId);
  });
}

export function filterAudioEqInstances(
  instances: readonly AudioEqInstanceDescriptor[],
  filter: AudioEqInstanceRegistryFilter = {},
): AudioEqInstanceDescriptor[] {
  const query = filter.query?.trim().toLowerCase();
  const scope = filter.scope ?? 'all';
  return instances.filter(instance => (
    (scope === 'all' || instance.scope === scope) &&
    (!query || instance.searchText.includes(query))
  ));
}

export function findAudioEqInstance(
  instances: readonly AudioEqInstanceDescriptor[],
  instanceId: string,
): AudioEqInstanceDescriptor | undefined {
  return instances.find(instance => instance.id === instanceId);
}
