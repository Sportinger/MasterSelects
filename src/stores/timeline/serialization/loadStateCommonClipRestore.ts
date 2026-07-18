import { clonePersistedClipAudioState } from '../../../services/audio/clipAudioStatePersistence';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import type { SerializableClip, TimelineClip } from '../types';
import { restorePersistedClipVideoState } from '../nestedRestore';

export function applyCommonRestoredClipFields(serializedClip: SerializableClip): Pick<
  TimelineClip,
  | 'videoState'
  | 'audioState'
  | 'transform'
  | 'effects'
  | 'transitionIn'
  | 'transitionOut'
  | 'transitionSourceMap'
  | 'transitionRecipeBlendWindows'
  | 'colorCorrection'
  | 'nodeGraph'
  | 'masks'
  | 'speed'
  | 'preservesPitch'
  | 'sourceRect'
  | 'transitionRender'
> {
  return {
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    transform: serializedClip.transform,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    masks: serializedClip.masks,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    sourceRect: serializedClip.sourceRect ? { ...serializedClip.sourceRect } : undefined,
    transitionRender: serializedClip.transitionRender ? structuredClone(serializedClip.transitionRender) : undefined,
  };
}

export function createLoadStateLiveInputClip(serializedClip: SerializableClip): TimelineClip | undefined {
  if (!serializedClip.liveInputId) return undefined;
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || 'Live Input',
    file: new File([], 'live-input.dat', { type: 'application/octet-stream' }),
    mediaFileId: serializedClip.mediaFileId || serializedClip.liveInputId,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: {
      type: 'video',
      liveInputId: serializedClip.liveInputId,
      mediaFileId: serializedClip.mediaFileId || serializedClip.liveInputId,
      naturalDuration: Number.MAX_SAFE_INTEGER,
    },
    ...applyCommonRestoredClipFields(serializedClip),
    isLoading: false,
  };
}
