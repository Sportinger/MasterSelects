
import type { TimelineClip } from '../../types/timeline';
import type { ClipMask, MaskPathKeyframeValue } from '../../types/masks';
import { createMaskEdgeFeatherProperty, parseMaskProperty } from '../../types/animationProperties';
import { createMaskEdgeId, getMaskEdgeFeather, setMaskEdgeFeatherValue } from '../../utils/maskEdgeFeathers';
import type { PropertyDescriptor } from '../../types/propertyRegistry';

function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map((vertex) => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getMaskDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const parsed = parseMaskProperty(path);
  if (!parsed || !clip?.masks) return undefined;

  const mask = clip.masks.find((candidate) => candidate.id === parsed.maskId);
  if (!mask) return undefined;

  if (parsed.property === 'path') {
    return {
      path,
      label: `${mask.name} Path`,
      group: 'Masks',
      valueType: 'path',
      animatable: true,
      defaultValue: getMaskPathValue(mask),
      ui: { aliases: ['mask path', mask.name] },
      read: (targetClip) => {
        const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
        return targetMask ? getMaskPathValue(targetMask) : undefined;
      },
      write: (targetClip, value) => {
        const pathValue = value as MaskPathKeyframeValue;
        return {
          ...targetClip,
          masks: targetClip.masks?.map((candidate) => (
            candidate.id === parsed.maskId
              ? {
                  ...candidate,
                  closed: pathValue.closed,
                  vertices: pathValue.vertices.map((vertex) => ({
                    ...vertex,
                    handleIn: { ...vertex.handleIn },
                    handleOut: { ...vertex.handleOut },
                  })),
                }
              : candidate
          )),
        };
      },
    };
  }

  if (parsed.property === 'edgeFeather') {
    const edgeIndex = mask.vertices.findIndex((vertex, index) => {
      const nextVertex = mask.vertices[index + 1] ?? (mask.closed ? mask.vertices[0] : undefined);
      return nextVertex ? createMaskEdgeId(vertex.id, nextVertex.id) === parsed.edgeId : false;
    });
    if (edgeIndex < 0) return undefined;

    return {
      path,
      label: `${mask.name} Edge ${edgeIndex + 1} Feather`,
      group: 'Masks',
      valueType: 'number',
      animatable: true,
      defaultValue: 0,
      ui: { min: 0, max: 500, step: 0.1, aliases: [mask.name, 'edge feather'] },
      read: (targetClip) => {
        const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
        return targetMask ? getMaskEdgeFeather(targetMask, parsed.edgeId) : undefined;
      },
      write: (targetClip, value) => ({
        ...targetClip,
        masks: targetClip.masks?.map((candidate) => (
          candidate.id === parsed.maskId
            ? {
                ...candidate,
                edgeFeathers: setMaskEdgeFeatherValue(candidate.edgeFeathers, parsed.edgeId, value as number),
              }
            : candidate
        )),
      }),
    };
  }

  const numericProperty = parsed.property as 'position.x' | 'position.y' | 'feather' | 'featherQuality';
  const labelByProperty: Record<typeof numericProperty, string> = {
    'position.x': `${mask.name} X`,
    'position.y': `${mask.name} Y`,
    feather: `${mask.name} Feather`,
    featherQuality: `${mask.name} Feather Quality`,
  };

  return {
    path,
    label: labelByProperty[numericProperty],
    group: 'Masks',
    valueType: 'number',
    animatable: true,
      defaultValue: numericProperty.startsWith('position.') ? 0 : numericProperty === 'featherQuality' ? 1 : 0,
    ui: {
      min: numericProperty === 'feather' ? 0 : numericProperty === 'featherQuality' ? 1 : undefined,
      max: numericProperty === 'featherQuality' ? 100 : undefined,
      step: numericProperty === 'featherQuality' ? 1 : 0.1,
      aliases: [mask.name, numericProperty],
    },
    read: (targetClip) => {
      const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
      if (!targetMask) return undefined;
      if (numericProperty === 'position.x') return targetMask.position.x;
      if (numericProperty === 'position.y') return targetMask.position.y;
      return targetMask[numericProperty];
    },
    write: (targetClip, value) => ({
      ...targetClip,
      masks: targetClip.masks?.map((candidate) => {
        if (candidate.id !== parsed.maskId) return candidate;
        if (numericProperty === 'position.x') {
          return { ...candidate, position: { ...candidate.position, x: value as number } };
        }
        if (numericProperty === 'position.y') {
          return { ...candidate, position: { ...candidate.position, y: value as number } };
        }
        return { ...candidate, [numericProperty]: value as number };
      }),
    }),
  };
}

export function getMaskDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return (clip.masks ?? []).flatMap((mask) => {
    const edgeProperties = mask.vertices.flatMap((vertex, index) => {
      const nextVertex = mask.vertices[index + 1] ?? (mask.closed ? mask.vertices[0] : undefined);
      return nextVertex ? [createMaskEdgeFeatherProperty(mask.id, createMaskEdgeId(vertex.id, nextVertex.id))] : [];
    });
    return [
      getMaskDescriptorForPath(`mask.${mask.id}.path`, clip),
      getMaskDescriptorForPath(`mask.${mask.id}.position.x`, clip),
      getMaskDescriptorForPath(`mask.${mask.id}.position.y`, clip),
      getMaskDescriptorForPath(`mask.${mask.id}.feather`, clip),
      getMaskDescriptorForPath(`mask.${mask.id}.featherQuality`, clip),
      ...edgeProperties.map(property => getMaskDescriptorForPath(property, clip)),
    ].filter((descriptor): descriptor is PropertyDescriptor => Boolean(descriptor));
  });
}
