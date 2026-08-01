import {
  PRIMARY_COLOR_PARAM_DEFS,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getColorNodeParamValue,
  parseColorProperty,
} from '../../../types/colorCorrection';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import type { HeaderKeyframe, KeyframeTrackClip } from './timelineHeaderPropertyTypes';

const colorParamDefsByKey = new Map(PRIMARY_COLOR_PARAM_DEFS.map((def) => [def.key, def]));

function prettifyParamName(paramName: string): string {
  return paramName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

export function getTimelineHeaderColorPropertyMeta(
  prop: string,
  clip?: KeyframeTrackClip | null,
) {
  const parsed = parseColorProperty(prop);
  if (!parsed) return null;

  const colorState = clip?.colorCorrection ? ensureColorCorrectionState(clip.colorCorrection) : null;
  const version = colorState?.versions.find((entry) => entry.id === parsed.versionId)
    ?? (colorState ? getActiveColorVersion(colorState) : undefined);
  const node = version?.nodes.find((entry) => entry.id === parsed.nodeId);
  const def = colorParamDefsByKey.get(parsed.paramName as (typeof PRIMARY_COLOR_PARAM_DEFS)[number]['key']);

  return {
    ...parsed,
    nodeName: node?.name,
    label: def?.label ?? prettifyParamName(parsed.paramName),
    defaultValue: def?.defaultValue ?? 0,
    decimals: def?.decimals ?? 2,
    step: def?.step ?? 0.01,
  };
}

export function getTimelineHeaderColorPropertyValue(
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: HeaderKeyframe[],
  clipLocalTime: number,
): number | null {
  const colorMeta = getTimelineHeaderColorPropertyMeta(prop, clip);
  if (!colorMeta || !clip.colorCorrection) return null;

  const colorState = ensureColorCorrectionState(clip.colorCorrection);
  const baseValue = getColorNodeParamValue(
    colorState,
    colorMeta.nodeId,
    colorMeta.paramName,
    colorMeta.defaultValue,
  );

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
}
