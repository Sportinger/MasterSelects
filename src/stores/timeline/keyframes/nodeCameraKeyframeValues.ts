import type { ClipCustomNodeParamValue, TimelineClip } from '../../../types';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../mediaStore/types';
import {
  normalizeHexColor,
  parseColorChannelParamName,
  setHexColorChannel,
} from '../../../utils/colorParam';

function isCustomNodeParamValue(value: unknown): value is ClipCustomNodeParamValue {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

export function getCustomNodeParamDefaults(
  clip: TimelineClip,
  nodeId: string,
): Record<string, ClipCustomNodeParamValue> {
  const definition = clip.nodeGraph?.customNodes?.find((node) => node.id === nodeId);
  if (!definition) {
    return {};
  }

  const params: Record<string, ClipCustomNodeParamValue> = {};
  const schemaById = new Map((definition.parameterSchema ?? []).map((param) => [param.id, param]));
  for (const param of definition.parameterSchema ?? []) {
    const value = definition.params?.[param.id] ?? param.default;
    params[param.id] = param.type === 'color' ? normalizeHexColor(value, String(param.default)) : value;
  }
  for (const [key, value] of Object.entries(definition.params ?? {})) {
    if (isCustomNodeParamValue(value)) {
      const schema = schemaById.get(key);
      params[key] = schema?.type === 'color' ? normalizeHexColor(value, String(schema.default)) : value;
    }
  }
  return params;
}

export function setCustomNodeParamValue(
  clip: TimelineClip,
  nodeId: string,
  paramName: string,
  value: ClipCustomNodeParamValue,
): TimelineClip {
  const nodeGraph = clip.nodeGraph;
  if (!nodeGraph) {
    return clip;
  }
  const definition = nodeGraph.customNodes?.find((node) => node.id === nodeId);
  if (!definition) {
    return clip;
  }
  const colorChannel = parseColorChannelParamName(paramName);
  const colorParam = colorChannel
    ? definition.parameterSchema?.find((param) => param.id === colorChannel.paramId && param.type === 'color')
    : undefined;
  const nextParamName = colorParam ? colorParam.id : paramName;
  const nextValue = colorParam && typeof value === 'number'
    ? setHexColorChannel(
        definition.params?.[colorParam.id] ?? colorParam.default,
        colorChannel!.channel,
        value,
        String(colorParam.default),
      )
    : value;

  return {
    ...clip,
    nodeGraph: {
      ...nodeGraph,
      customNodes: nodeGraph.customNodes?.map((node) => (
        node.id === nodeId
          ? {
              ...node,
              params: {
                ...(node.params ?? {}),
                [nextParamName]: nextValue,
              },
            }
          : node
      )),
      updatedAt: Date.now(),
    },
  };
}

export function getCustomNodeDefinition(clip: TimelineClip, nodeId: string) {
  return clip.nodeGraph?.customNodes?.find((node) => node.id === nodeId);
}

export function normalizeCameraSettingValue(
  key: keyof SceneCameraSettings,
  value: number,
  currentSettings: SceneCameraSettings,
): number {
  if (key === 'fov') {
    return Math.max(10, Math.min(140, value));
  }
  if (key === 'exposure') return Math.max(-16, Math.min(16, value));
  if (key === 'fStop') return Math.max(0, Math.min(64, value));
  if (key === 'focusDistance') return Math.max(0, value);
  if (key === 'shutterAngle') return Math.max(0, Math.min(360, value));
  if (key === 'near') {
    return Math.max(0.001, value);
  }
  if (key === 'far') {
    return Math.max(currentSettings.near + 0.1, value);
  }
  return Math.max(1, Math.round(value));
}

export function buildCameraSettingsPatch(
  currentSettings: SceneCameraSettings | undefined,
  key: keyof SceneCameraSettings,
  value: number,
): SceneCameraSettings {
  const base = {
    ...DEFAULT_SCENE_CAMERA_SETTINGS,
    ...currentSettings,
  };
  const next = {
    ...base,
    [key]: normalizeCameraSettingValue(key, value, base),
  };

  if (key === 'near' && next.far <= next.near) {
    next.far = next.near + 0.1;
  }

  return next;
}
