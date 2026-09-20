import type { TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { resolveSceneClipCameraSettings, resolveSceneClipTransform } from '../../engine/scene/SceneTimelineUtils';
import { getInterpolatedClipLightSettings } from '../../utils/keyframeInterpolation';
import { mergeLightClipSettings } from '../../types/light';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import type { PreviewFrame, PreviewRequest } from './previewTypes';

export function sceneValuePreview(request: PreviewRequest, clip: TimelineClip): PreviewFrame | Promise<PreviewFrame> {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const binding = request.node.binding;
  const state = useTimelineStore.getState();
  const target = binding?.kind === 'scene-node' ? state.clips.find(value => value.id === binding.clipId) ?? clip : clip;
  const localTime = Math.max(0, request.time - target.startTime);
  const role = binding?.kind === 'scene-node' ? binding.role : 'transform';
  if (role === 'render') return nodePreviewTextureTap.request(`scene:${target.id}`, request);
  const transform = resolveSceneClipTransform(target, localTime, request.time, state);
  const vector = (value: { x: number; y: number; z?: number }) => [value.x, value.y, value.z ?? 0].map(n => n.toFixed(2)).join(', ');
  let lines = [`Position ${vector(transform.position)}`, `Rotation ${vector(transform.rotation)}`, `Scale ${vector(transform.scale)}`];
  if (role === 'camera') {
    const camera = resolveSceneClipCameraSettings(target, localTime, state);
    lines = [`FOV ${camera.fov.toFixed(1)}°`, `Near ${camera.near} / Far ${camera.far}`, `${camera.resolutionWidth} × ${camera.resolutionHeight}`, ...lines];
  } else if (role === 'light') {
    const light = getInterpolatedClipLightSettings(state.clipKeyframes.get(target.id) ?? [], localTime, mergeLightClipSettings(target.source?.lightSettings));
    lines = [`${light.kind} · ${light.color}`, `Intensity ${light.intensity.toFixed(2)}`, `Diameter ${light.diameter.toFixed(2)}`, `Shadows ${light.castsShadows ? light.shadowStrength.toFixed(2) : 'off'}`, ...lines];
  } else if (role === 'geometry') lines = [`${target.source?.type ?? 'Geometry'}`, ...lines];
  return { ...base, status: 'live', label: role === 'camera' ? 'Camera' : role === 'light' ? 'Light' : 'Scene values', drawing: { kind: 'text', lines } };
}
