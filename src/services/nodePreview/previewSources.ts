import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { findClipOperatorEffect } from '../operators/clipOperatorGraphOwner';
import { audioOperatorPreview } from './audioOperatorPreviews';
import { useTimelineStore } from '../../stores/timeline';
import type { AnimatableProperty } from '../../types/animationProperties';
import { landmarkRuntime } from '../landmarkTracking/landmarkRuntime';
import { faceTrackKey, samplePreciseFace } from '../landmarkTracking/preciseFaceSampling';
import { FACE_CABLE_ANCHORS } from '../faceCables/cableData';
import { effectOperatorGraph, isComputeImageEffectType, isImageGraphEffectType } from '../operators/effectGraphOwner';
import { sampleOperatorParameter, graphInputNodes } from '../operators/effectGraph';
import { clipLocalToKeyframeTime } from '../flock/time/flockKeyframeTime';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { sourcePreview } from './sourcePreview';
import type { PreviewFrame, PreviewRequest } from './previewTypes';
import type { PreviewArtifactReader } from './PreviewArtifactReader';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { getOrderedRuntimeNodes } from '../../types/colorCorrection';
import { scenePreview } from './scenePreviews';
import { sceneValuePreview } from './sceneValuePreviews';
import { getEffectOperator } from '../operators/operatorRegistry';
import { flockPreview } from './flockPreviews';
import { voxelPreview } from './voxelPreviews';
import { imageOperatorKnownValues, imageOperatorValuePreview } from './imageOperatorPreviews';
import { imageOperatorPreviewStage, isImageOperatorTextureSignal } from './imageOperatorPreviewStages';
import { analogSignalNodePreview, analogSignalPreviewProducerNode } from './analogSignalPreviews';
import type { AnalogSignalPreviewTarget } from './analogSignalPreviewStages';
import { computeImageOperatorValuePreview } from './computeImageOperatorPreviews';
import { memoryImageOperatorPreviewTap } from './memoryImageOperatorPreviews';

/** Domain adapters read authoritative runtime data; opening a viewer never runs analysis or a bake. */
export function produceNodePreview(request: PreviewRequest, artifacts?: PreviewArtifactReader): PreviewFrame | Promise<PreviewFrame> {
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(value => value.id === (request.node.params?.targetClipId ?? request.clipId));
  const base = { key: request.key, revision: request.revision, time: request.time, aspectRatio: request.node.preview?.aspectRatio };
  const missing = (label: string): PreviewFrame => ({ ...base, status: 'missing', label });
  if (!clip) return missing('Clip unavailable');
  const localTime = Math.max(0, Math.min(clip.duration, request.time - clip.startTime));
  const sourceTime = state.getSourceTimeForClip(clip.id, localTime), binding = request.node.binding;
  const semantic = request.port?.metadata?.semanticKind;
  if (binding?.kind === 'flock-node') return flockPreview(request, clip, sourceTime, state.clipKeyframes.get(clip.id) ?? []);
  if (binding?.kind === 'effect-operator') {
    const effect = findClipOperatorEffect(clip, binding.effectId);
    if (effect?.type === 'audio-math') return audioOperatorPreview({ ...request, clipId: clip.id }, effect);
    if (effect?.type === 'voxel-relief') return voxelPreview(request, clip, effect, state.clipKeyframes.get(clip.id) ?? [], localTime);
    if (effect && isComputeImageEffectType(effect.type)) {
      const preview = computeImageOperatorValuePreview(request, clip, effect, state.clipKeyframes.get(clip.id) ?? [], localTime);
      if (preview) return preview;
      const signal = request.port?.metadata?.semanticKind;
      if (request.port && binding.operator !== 'image.frame' && isImageOperatorTextureSignal(signal)) {
        return nodePreviewTextureTap.request(imageOperatorPreviewStage({ effectId: effect.id, nodeId: binding.nodeId,
          portId: request.port.id, direction: request.port.direction }), request);
      }
    }
    if (effect && isImageGraphEffectType(effect.type)) {
      const keys = state.clipKeyframes.get(clip.id) ?? [];
      const valuePreview = imageOperatorValuePreview(request, clip, effect, keys, localTime);
      if (valuePreview) return valuePreview;
      const port = request.port;
      const signal = port?.metadata?.semanticKind;
      if (port && binding.operator === 'source.memory-window' && (signal === 'operator:uint32-texture' || port.id === 'metadata')) {
        return memoryImageOperatorPreviewTap.request({ effectId: effect.id, nodeId: binding.nodeId,
          portId: port.id, direction: port.direction }, request);
      }
      if (port && binding.operator !== 'image.frame' && isImageOperatorTextureSignal(signal)) {
        const knownValues = imageOperatorKnownValues(request, clip, effect, keys, localTime);
        return nodePreviewTextureTap.request(imageOperatorPreviewStage({ effectId: effect.id, nodeId: binding.nodeId,
          portId: port.id, direction: port.direction }), request).then(frame => knownValues.length ? { ...frame, values: knownValues } : frame);
      }
    }
    if (effect?.type === 'analog-signal-lab') {
      const keys = state.clipKeyframes.get(clip.id) ?? [];
      const valuePreview = imageOperatorValuePreview(request, clip, effect, keys, localTime);
      if (valuePreview) return valuePreview;
      if (binding.operator === 'image.frame' && request.port?.type === 'texture') return sourcePreview(request, clip, sourceTime);
      if (request.port?.type === 'texture') {
        const graph = effectOperatorGraph(effect);
        const target: AnalogSignalPreviewTarget = { effectId: effect.id, nodeId: binding.nodeId, portId: request.port.id, direction: request.port.direction };
        const producer = analogSignalPreviewProducerNode(graph, target);
        if (graph.nodes.find(value => value.id === producer)?.operator === 'image.frame') return sourcePreview(request, clip, sourceTime);
      }
      const preview = analogSignalNodePreview(request, effect); if (preview) return preview;
    }
  }
  const artifact = request.port?.metadata?.sourceArtifact;
  const operator = binding?.kind === 'effect-operator' || binding?.kind === 'scene-operator' ? binding.operator : '';
  if (artifacts && (artifact?.kind === 'scene-depth' || ['depth.calibrate', 'geometry.face', 'geometry.depth', 'geometry.merge-surface', 'collision.mesh', 'simulation.rope'].includes(operator))) {
    const effectId = artifact?.effectId ?? (binding?.kind === 'effect-operator' ? binding.effectId : undefined);
    const effect = clip.effects.find(value => value.id === effectId);
    if (!effect) return missing('Effect unavailable');
    let stage = artifact?.kind === 'scene-depth' || operator === 'depth.calibrate' ? 'depth' : operator === 'geometry.face' ? 'face' : operator === 'geometry.depth' ? 'depth-mesh' : operator === 'simulation.rope' ? 'cables' : 'surface';
    if (operator === 'collision.mesh' && binding?.kind === 'effect-operator') {
      const graph = effectOperatorGraph(effect), input = graphInputNodes(graph, binding.nodeId, 'geometry')[0];
      stage = input?.operator === 'geometry.face' ? 'face' : 'surface';
    }
    const scene = typeof effect.params.sceneData === 'string' ? effect.params.sceneData : '';
    const cable = typeof effect.params.bakedData === 'string' ? effect.params.bakedData : '';
    const data = scene || (stage === 'cables' ? cable : '');
    if (!data) return missing('Not baked');
    return artifacts.sample(`${clip.id}:${effect.id}:${scene ? 'scene' : 'cables'}`, data, scene ? 'scene' : 'cables', stage, localTime).then(result => ({
      ...base, status: result.drawing ? request.port?.metadata?.stale ? 'stale' : 'saved' : 'missing', label: result.label, drawing: result.drawing,
    }));
  }
  if (artifact?.kind === 'face-landmarks' || ['tracking.face', 'tracking.smooth', 'tracking.anchors'].includes(operator)) {
    let smoothing = 0;
    if (binding?.kind === 'effect-operator' && operator !== 'tracking.face') {
      const effect = clip.effects.find(value => value.id === binding.effectId);
      if (effect) {
        const graph = effectOperatorGraph(effect);
        let node = graph.nodes.find(value => value.id === binding.nodeId);
        if (node?.operator === 'tracking.anchors') node = graphInputNodes(graph, node.id, 'landmarks')[0];
        if (node?.operator === 'tracking.smooth') smoothing = Number(sampleOperatorParameter(node, 'strength', effect.params, effect.id, state.clipKeyframes.get(clip.id) ?? [], localTime));
      }
    }
    const frame = samplePreciseFace(landmarkRuntime.getSeries(faceTrackKey(clip.id)), sourceTime, smoothing);
    const face = frame?.faces[0];
    if (!face?.length) return missing('No tracking at this time');
    const points = operator === 'tracking.anchors'
      ? Object.values(FACE_CABLE_ANCHORS).map(anchor => {
        const found = anchor.indices.map(index => face[index]).filter(Boolean);
        return found.length ? [found.reduce((n, point) => n + point.x, 0) / found.length, found.reduce((n, point) => n + point.y, 0) / found.length] : [];
      }).flat() : face.flatMap(point => [point.x, point.y]);
    return { ...base, status: 'saved', label: operator === 'tracking.anchors' ? 'Face anchors' : smoothing ? 'Smoothed landmarks' : 'Tracked landmarks', drawing: { kind: 'points', dimensions: 2, points } };
  }
  if (request.port?.type === 'audio' || semantic === 'waveform') {
    const target = state.clips.find(value => value.id === request.port?.metadata?.targetClipId) ?? state.clips.find(value => value.id === clip.linkedClipId) ?? clip;
    const waveform = target.waveform;
    if (!waveform?.length) return missing('Waveform not available');
    const values = Array.from({ length: Math.min(160, waveform.length) }, (_, index) => waveform[Math.floor(index * waveform.length / Math.min(160, waveform.length))]);
    return { ...base, status: 'saved', label: 'Waveform', drawing: { kind: 'plot', values, cursor: localTime / Math.max(0.001, clip.duration) } };
  }
  if (binding?.kind === 'keyframe-node' || request.port?.metadata?.animationProperty) {
    const property = request.port?.metadata?.animationProperty as AnimatableProperty;
    if (!property) return missing('No animation channel');
    const keys = state.clipKeyframes.get(clip.id) ?? [];
    const values = Array.from({ length: 80 }, (_, index) => interpolateKeyframes(keys, property,
      clipLocalToKeyframeTime(clip, property, index / 79 * clip.duration, state.getSourceTimeForClip), 0));
    return { ...base, status: 'live', label: String(interpolateKeyframes(keys, property, clipLocalToKeyframeTime(clip, property, localTime, state.getSourceTimeForClip), 0)),
      drawing: { kind: 'plot', values, cursor: localTime / Math.max(0.001, clip.duration), bipolar: true } };
  }
  if ((binding?.kind === 'clip-source' || operator === 'media.source' || operator === 'image.frame') && request.port?.type === 'texture' && !artifact && (!semantic || semantic === 'operator:image')) return sourcePreview(request, clip, sourceTime);
  if (binding?.kind === 'scene-operator') return scenePreview(request, clip, localTime, sourceTime, artifacts);
  if (binding?.kind === 'scene-node' || binding?.kind === 'clip-transform' || binding?.kind === 'clip-stabilization') return sceneValuePreview(request, clip);
  if (binding?.kind === 'effect-operator' && operator === 'scene.transform') return sceneValuePreview(request, clip);
  if (binding?.kind === 'clip-mask-stack') return nodePreviewTextureTap.request(`mask:${clip.id}`, request);
  if (binding?.kind === 'clip-effect') {
    const index = clip.effects.findIndex(value => value.id === binding.effectId), effect = clip.effects[index];
    if (!effect) return missing('Effect unavailable');
    if (effect.type === 'face-cables' && effect.params.scene3D) return nodePreviewTextureTap.request(`scene:${clip.id}`, request);
    const upstream = effect.enabled ? effect : clip.effects.slice(0, index).findLast(value => value.enabled && !value.type.startsWith('audio-'));
    return nodePreviewTextureTap.request(upstream ? `effect:${upstream.id}` : `color:${clip.id}`, request);
  }
  if (binding?.kind === 'effect-operator' && ['render.cables', 'scene.output'].includes(operator)) {
    const effect = clip.effects.find(value => value.id === binding.effectId);
    return nodePreviewTextureTap.request(effect?.params.scene3D ? `scene:${clip.id}` : `effect:${binding.effectId}`, request);
  }
  if (binding?.kind === 'clip-color-correction' || binding?.kind === 'color-node') {
    if (request.port?.type === 'mask') return missing('No key signal in the realtime color graph');
    const input = binding.kind === 'color-node' && ['input', 'source'].includes(binding.nodeType);
    if (binding.kind === 'color-node' && !input && binding.nodeType !== 'output') {
      const version = clip.colorCorrection?.versions.find(value => value.id === binding.versionId);
      const ordered = version ? getOrderedRuntimeNodes(version).map(value => value.id) : [binding.nodeId];
      return nodePreviewTextureTap.request(`color-node:${clip.id}:${binding.nodeId}`, { ...request, colorNodeIds: ordered.slice(0, ordered.indexOf(binding.nodeId) + 1) });
    }
    return nodePreviewTextureTap.request(`${input ? 'color-input' : 'color'}:${clip.id}`, request);
  }
  if (binding?.kind === 'clip-output') return nodePreviewTextureTap.request(`output:${clip.id}`, request);
  if (binding?.kind === 'effect-operator') {
    if (operator === 'depth.estimate') return missing('Raw depth is not retained after baking');
    const effect = clip.effects.find(value => value.id === binding.effectId), spec = getEffectOperator(operator);
    const node = effect && effectOperatorGraph(effect).nodes.find(value => value.id === binding.nodeId);
    if (node && effect && spec?.parameters.length) {
      const keys = state.clipKeyframes.get(clip.id) ?? [];
      const sample = (name: string) => sampleOperatorParameter(node, name, effect.params, effect.id, keys, localTime);
      const value = operator === 'values.oscillator' ? Number(sample('offset')) + Number(sample('amplitude')) * Math.sin(localTime * 2 * Math.PI * Number(sample('frequency'))) : undefined;
      return { ...base, status: 'live', label: 'Sampled values', drawing: { kind: 'text', lines: [...(value === undefined ? [] : [`Output: ${value.toFixed(3)}`]), ...spec.parameters.map(param => `${param.label}: ${String(sample(param.id)).slice(0, 48)}`)].slice(0, 6) } };
    }
  }
  if (binding?.kind === 'clip-source' && request.port?.type === 'time') return { ...base, status: 'live', label: 'Source time', drawing: { kind: 'text', lines: [`${sourceTime.toFixed(3)} s`, `Clip ${localTime.toFixed(3)} s`] } };
  if (request.port?.type === 'number' || request.port?.type === 'boolean' || request.port?.type === 'metadata' || !request.port) {
    return { ...base, status: 'live', label: 'Values', drawing: { kind: 'text', lines: Object.entries(request.node.params ?? {}).slice(0, 6).map(([key, value]) => `${key}: ${String(value).slice(0, 48)}`) } };
  }
  return missing('Waiting for runtime output');
}
