import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import type { AnimatableProperty } from '../../types/animationProperties';
import type { KeyframeNodeDefinition } from '../../types/keyframeNode';
import type { NodeGraphLayout } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { createClipNodeGraphState } from './clipGraphProjectionState';
import { keyframeNodeParameters, validateKeyframeNodeTarget } from './keyframeNodeParameters';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { clipLocalToKeyframeTime } from '../flock/time/flockKeyframeTime';
import { renderHostPort } from '../render/renderHostPort';
import { withLegacyKeyframeNodes } from './legacyKeyframeNodes';

function edit(clipId: string, label: string, apply: (nodes: KeyframeNodeDefinition[]) => void) {
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('The clip is locked or exporting.');
  const resolved = withLegacyKeyframeNodes(clip, state.clipKeyframes.get(clipId) ?? []);
  const model = resolved.nodeGraph ?? createClipNodeGraphState(resolved);
  const nodes = structuredClone(model.keyframeNodes ?? []);
  apply(nodes);
  const batch = startBatch(label);
  try {
    const transformAnimated = nodes.some(node => node.channels.some(channel =>
      [channel.property, ...channel.targets.map(target => target.property)].some(property => /^(opacity$|speed$|position\.|anchor\.|scale\.|rotation\.)/.test(property))));
    state.updateClip(clipId, { nodeGraph: { ...model, keyframeNodes: nodes,
      forcedBuiltIns: transformAnimated ? [...new Set([...(model.forcedBuiltIns ?? []), 'transform' as const])] : model.forcedBuiltIns,
    } });
    state.invalidateCache();
    renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

export function addKeyframeNode(clipId: string, layout: NodeGraphLayout = { x: 0, y: -220 }): string {
  const id = `keyframes-${crypto.randomUUID()}`;
  edit(clipId, 'Add keyframe node', nodes => nodes.push({ id, label: 'Keyframes', layout, channels: [], presentation: 'node' }));
  return id;
}

export function changeKeyframeNode(clipId: string, nodeId: string, patch: Partial<Pick<KeyframeNodeDefinition, 'label' | 'layout' | 'presentation'>>) {
  edit(clipId, 'Edit keyframe node', nodes => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) throw new Error('Keyframe node not found.');
    Object.assign(node, patch);
  });
}

export function extractKeyframeChannel(clipId: string, nodeId: string, channelId: string, layout: NodeGraphLayout): string {
  const id = `keyframes-${crypto.randomUUID()}`;
  edit(clipId, 'Extract animation node', nodes => {
    const node = nodes.find(candidate => candidate.id === nodeId);
    const channel = node?.channels.find(candidate => candidate.id === channelId);
    if (!node || !channel) throw new Error('Animation channel not found.');
    node.channels = node.channels.filter(candidate => candidate !== channel);
    if (!node.channels.length) nodes.splice(nodes.indexOf(node), 1);
    nodes.push({ id, label: 'Keyframes', layout, presentation: 'node', channels: [channel] });
  });
  return id;
}

export function removeKeyframeNode(clipId: string, nodeId: string) {
  edit(clipId, 'Remove keyframe node', nodes => { const index = nodes.findIndex(n => n.id === nodeId); if (index >= 0) nodes.splice(index, 1); });
}

export function connectKeyframeNode(clipId: string, nodeId: string, property: AnimatableProperty, channelId?: string,
  mapping?: { scale: number; offset: number }) {
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(c => c.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  const parameters = keyframeNodeParameters(clip), target = parameters.find(p => p.property === property);
  if (!target) throw new Error('This parameter does not support timeline keyframes.');
  if (mapping && (!Number.isFinite(mapping.scale) || mapping.scale === 0 || !Number.isFinite(mapping.offset))) throw new Error('Mapping requires a finite nonzero scale and a finite offset.');
  const batch = startBatch('Connect keyframe node');
  try {
    edit(clipId, 'Connect keyframe node', nodes => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) throw new Error('Keyframe node not found.');
      const occupiedNode = nodes.find(n => n.channels.some(c => c.property === property || c.targets.some(t => t.property === property)));
      if (occupiedNode) {
        const movable = occupiedNode.id !== node.id && occupiedNode.presentation !== 'node'
          && occupiedNode.channels.every(c => c.targets.length === 0);
        if (!movable) throw new Error('This parameter already belongs to a keyframe node. Disconnect it first.');
        occupiedNode.channels = occupiedNode.channels.filter(c => c.property !== property);
        if (!occupiedNode.channels.length) nodes.splice(nodes.indexOf(occupiedNode), 1);
      }
      if (channelId) {
        const channel = node.channels.find(c => c.id === channelId), source = channel && parameters.find(p => p.property === channel.property);
        if (!channel || !source) throw new Error('Source parameter not found.');
        validateKeyframeNodeTarget(source, target, Boolean(mapping));
        channel.targets.push({ property, scale: mapping?.scale ?? 1, offset: mapping?.offset ?? 0 });
      } else node.channels.push({ id: crypto.randomUUID(), property, targets: [] });
    });
    if (!channelId && !state.hasKeyframes(clipId, property)) {
      const time = Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime));
      const value = interpolateKeyframes(state.clipKeyframes.get(clipId) ?? [], property,
        clipLocalToKeyframeTime(clip, property, time, state.getSourceTimeForClip), target.value);
      state.addKeyframe(clipId, property, value, time);
    }
    if (!channelId && target.discrete) {
      for (const key of readTimelineRuntimeState(useTimelineStore).clipKeyframes.get(clipId) ?? []) {
        if (key.property === property && !key.hold) state.updateKeyframe(key.id, { hold: true });
      }
    }
  } finally { if (batch.opened) endBatch(); }
}

export function disconnectKeyframeNode(clipId: string, nodeId: string, property: string) {
  edit(clipId, 'Disconnect keyframe parameter', nodes => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.channels = node.channels.filter(channel => channel.property !== property).map(channel => ({
      ...channel, targets: channel.targets.filter(target => target.property !== property),
    }));
  });
}
