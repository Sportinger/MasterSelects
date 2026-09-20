import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { KeyframeNodeChannel, KeyframeNodeDefinition } from '../../types/keyframeNode';
import { clearProcessedAudioAnalysisRefsForKeyframeTargets, type AudioKeyframeInvalidationTarget } from '../../stores/timeline/keyframes/audioEffectKeyframeValues';

type KeyframeState = { clips: TimelineClip[]; clipKeyframes: Map<string, Keyframe[]> };

function ownerExists(clip: TimelineClip, property: string): boolean {
  const parts = property.split('.');
  if (parts[0] === 'effect') return clip.effects.some(e => e.id === parts[1]) || Boolean(clip.audioState?.effectStack?.some(e => e.id === parts[1]));
  if (parts[0] === 'node') return Boolean(clip.nodeGraph?.customNodes?.some(n => n.id === parts[1]));
  if (parts[0] === 'flock') return Boolean(clip.flock?.nodes.some(n => n.id === parts[2]));
  if (parts[0] === 'mask') return Boolean(clip.masks?.some(m => m.id === parts[1]));
  if (parts[0] === 'color') return Boolean(clip.colorCorrection?.versions.find(v => v.id === parts[1])?.nodes.some(n => n.id === parts[2]));
  return true;
}

function sameCurve(a: readonly Keyframe[], b: readonly Keyframe[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i] || JSON.stringify(key) === JSON.stringify(b[i]));
}

function mapValue(key: Keyframe, scale: number, offset: number): Keyframe {
  return {
    ...key, value: key.value * scale + offset,
    ...(key.handleIn ? { handleIn: { x: key.handleIn.x, y: key.handleIn.y * scale } } : {}),
    ...(key.handleOut ? { handleOut: { x: key.handleOut.x, y: key.handleOut.y * scale } } : {}),
  };
}

function sourceKeys(
  node: KeyframeNodeDefinition, channel: KeyframeNodeChannel,
  keys: Keyframe[], previous: Keyframe[], oldNode?: KeyframeNodeDefinition,
): Keyframe[] {
  const source = keys.filter(k => k.property === channel.property);
  const before = previous.filter(k => k.property === channel.property);
  // Restores, loads, direct source edits and changes to the binding always use the source.
  if (!oldNode || !sameCurve(source, before)) return source;
  const oldChannel = oldNode.channels.find(c => c.id === channel.id && c.property === channel.property);
  for (const target of channel.targets) {
    if (!oldChannel?.targets.some(t => t.property === target.property && t.scale === target.scale && t.offset === target.offset)) continue;
    const targetKeys = keys.filter(k => k.property === target.property);
    if (sameCurve(targetKeys, previous.filter(k => k.property === target.property))) continue;
    // Edits through a linked timeline lane write through to its shared curve.
    return targetKeys.map(key => {
      const mapped = mapValue(key, 1 / target.scale, -target.offset / target.scale);
      const { animationSource, ...plain } = mapped;
      return { ...plain, id: animationSource?.nodeId === node.id && animationSource.channelId === channel.id
        ? animationSource.keyframeId : key.id, property: channel.property };
    });
  }
  return source;
}

/**
 * Compile shared curves to ordinary timeline lanes at the mutation boundary.
 * All existing renderers, bakes, export, clipboard and curve editors therefore
 * consume the same values. There is no playback subscriber or second curve store.
 */
export function synchronizeKeyframeNodes<T extends Partial<KeyframeState>>(previous: KeyframeState, patch: T): T {
  if (!patch.clips && !patch.clipKeyframes) return patch;
  const clips = patch.clips ?? previous.clips;
  const input = patch.clipKeyframes ?? previous.clipKeyframes;
  const previousClips = new Map(previous.clips.map(clip => [clip.id, clip]));
  let result = input;
  const invalidations: AudioKeyframeInvalidationTarget[] = [];
  for (const clip of clips) {
    const nodes = clip.nodeGraph?.keyframeNodes;
    const oldClip = previousClips.get(clip.id);
    const oldNodes = oldClip?.nodeGraph?.keyframeNodes;
    if (!nodes?.length && !oldNodes?.length) continue;
    const keys = input.get(clip.id) ?? [];
    const oldKeys = previous.clipKeyframes.get(clip.id) ?? [];
    if (keys === oldKeys && clip === oldClip) continue;
    let next = keys;
    const activeTargets = new Set<string>();
    for (const node of nodes ?? []) {
      for (const channel of node.channels) {
        // Removing a parameter owner must not erase animation on surviving targets.
        if (!ownerExists(clip, channel.property)) continue;
        const targets = channel.targets.filter(target => ownerExists(clip, target.property));
        const source = sourceKeys(node, channel, keys, oldKeys, oldNodes?.find(n => n.id === node.id));
        const destinations = new Set([channel.property, ...targets.map(t => t.property)]);
        targets.forEach(target => activeTargets.add(target.property));
        const projected = targets.flatMap((target) => source.map(key => ({
          ...mapValue(key, target.scale, target.offset),
          id: `kfn:${clip.id}:${node.id}:${channel.id}:${target.property}:${key.id}`,
          property: target.property,
          animationSource: { nodeId: node.id, channelId: channel.id, keyframeId: key.id },
        })));
        next = [...next.filter(k => !destinations.has(k.property)), ...source, ...projected];
      }
    }
    // Disconnect/delete releases the materialized curve as normal editable keys.
    next = next.map(key => {
      if (!key.animationSource || activeTargets.has(key.property)) return key;
      const { animationSource: _source, ...plain } = key;
      return plain;
    }).toSorted((a, b) => a.time - b.time);
    if (sameCurve(keys, next)) continue;
    if (result === input) result = new Map(input);
    result.set(clip.id, next);
    for (const property of new Set([...keys, ...next].map(k => k.property))) {
      if (!sameCurve(keys.filter(k => k.property === property), next.filter(k => k.property === property))) invalidations.push({ clipId: clip.id, property });
    }
  }
  if (result === input) return patch;
  const invalidatedClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(clips, invalidations);
  return { ...patch, clipKeyframes: result, ...(invalidatedClips === clips ? {} : { clips: invalidatedClips }) };
}
