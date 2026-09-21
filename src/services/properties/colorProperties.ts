
import type { TimelineClip } from '../../types/timeline';
import {
  DEFAULT_PRIMARY_COLOR_PARAMS,
  RUNTIME_COLOR_PARAM_DEFS,
  ensureColorCorrectionState,
  isColorGradeNode,
  parseColorProperty,
  setColorNodeParamValue,
} from '../../types/colorCorrection';
import type { PropertyDescriptor } from '../../types/propertyRegistry';

const colorParamDefsByKey = new Map(RUNTIME_COLOR_PARAM_DEFS.map((def) => [def.key, def]));

export function getColorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor<number> | undefined {
  const parsed = parseColorProperty(path);
  if (!parsed || !clip?.colorCorrection) return undefined;

  const def = colorParamDefsByKey.get(parsed.paramName as keyof typeof DEFAULT_PRIMARY_COLOR_PARAMS);
  if (!def) return undefined;

  const state = ensureColorCorrectionState(clip.colorCorrection);
  const version = state.versions.find((candidate) => candidate.id === parsed.versionId);
  const node = version?.nodes.find((candidate) => candidate.id === parsed.nodeId);
  if (!node || !isColorGradeNode(node)) return undefined;

  return {
    path,
    label: def.label,
    group: `Color / ${node.name}`,
    valueType: 'number',
    animatable: true,
    defaultValue: def.defaultValue,
    controlSource: { domain: 'clip-scalar', unit: def.key === 'hue' ? 'degrees' : def.key === 'exposure' ? 'stops' : 'number' },
    ui: {
      min: def.min,
      max: def.max,
      step: def.step,
      aliases: [def.section, node.type, parsed.paramName],
    },
    read: (targetClip) => {
      const currentState = ensureColorCorrectionState(targetClip.colorCorrection);
      const currentVersion = currentState.versions.find((candidate) => candidate.id === parsed.versionId);
      const currentNode = currentVersion?.nodes.find((candidate) => candidate.id === parsed.nodeId);
      const value = currentNode?.params[parsed.paramName];
      return typeof value === 'number' ? value : def.defaultValue;
    },
    write: (targetClip, value) => ({
      ...targetClip,
      colorCorrection: setColorNodeParamValue(
        ensureColorCorrectionState(targetClip.colorCorrection),
        parsed.versionId,
        parsed.nodeId,
        parsed.paramName,
        value as number,
      ),
    }),
  };
}

export function getColorDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  if (!clip.colorCorrection) return [];

  const state = ensureColorCorrectionState(clip.colorCorrection);
  return state.versions.flatMap((version) =>
    version.nodes.filter(isColorGradeNode).flatMap((node) =>
      RUNTIME_COLOR_PARAM_DEFS.flatMap(({ key }) => {
        const descriptor = getColorDescriptorForPath(`color.${version.id}.${node.id}.${key}`, clip);
        return descriptor ? [descriptor] : [];
      })
    )
  );
}
