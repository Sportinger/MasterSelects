import type { TimelineClip } from '../../types/timeline';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { parseTextProperty, TEXT_NUMERIC_PARAMETERS, normalizeTextValue, type TextNumericParameter } from '../text/textAnimation';

export function getTextDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const key = parseTextProperty(path);
  if (!key || !clip?.textProperties || clip.captionLayerBinding) return undefined;
  const definition = TEXT_NUMERIC_PARAMETERS[key];
  return { path, label: definition.label, group: 'Text', valueType: 'number', animatable: true,
    defaultValue: definition.fallback, ui: { min: definition.min, max: definition.max, step: definition.step },
    read: target => target.textProperties?.[key],
    write: (target, value) => !target.textProperties ? target : ({ ...target,
      textProperties: { ...target.textProperties, [key]: normalizeTextValue(key, Number(value)) } }),
  };
}
export function getTextDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return (Object.keys(TEXT_NUMERIC_PARAMETERS) as TextNumericParameter[])
    .flatMap(key => { const descriptor = getTextDescriptorForPath(`text.${key}`, clip); return descriptor ? [descriptor] : []; });
}
