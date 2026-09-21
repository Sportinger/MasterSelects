import type { EffectParam } from '../../effects/types';
import type { ImageOperatorNamedImage } from './imageOperatorResources';
import type { ResolveImageOperatorGlyphAtlas } from './imageOperatorGlyphResources';
import type { ImageOperatorFieldResource } from './imageOperatorFieldResources';

export interface ImageOperatorCompileContext {
  parameterSchema?: Record<string, EffectParam>;
  namedImages?: readonly ImageOperatorNamedImage[];
  allowFrameHistory?: boolean;
  allowMemoryWindow?: boolean;
  resolveGlyphAtlas?: ResolveImageOperatorGlyphAtlas;
  fieldResources?: readonly ImageOperatorFieldResource[];
}

function choiceSchema(binding: unknown, context: ImageOperatorCompileContext) {
  if (typeof binding !== 'string' || !binding) throw new Error('Image choice value must bind to an effect parameter.');
  const schema = context.parameterSchema?.[binding];
  if (!schema || schema.type !== 'select' || !schema.options?.length) throw new Error(`Image choice ${binding} requires a non-empty select parameter schema.`);
  const optionValues = schema.options.map(option => option.value);
  if (optionValues.some(value => typeof value !== 'string' || !value) || new Set(optionValues).size !== optionValues.length) {
    throw new Error(`Image choice ${binding} has invalid select options.`);
  }
  if (typeof schema.default !== 'string' || !schema.options.some(option => option.value === schema.default)) {
    throw new Error(`Image choice ${binding} has an invalid select default.`);
  }
  return { binding, optionValues, schema };
}

export function resolveImageOperatorChoiceValue(binding: unknown, params: Record<string, unknown>, context: ImageOperatorCompileContext): string {
  const choice = choiceSchema(binding, context);
  return typeof params[choice.binding] === 'string' && choice.optionValues.includes(params[choice.binding] as string)
    ? params[choice.binding] as string : choice.schema.default as string;
}

export function resolveImageOperatorChoice(binding: unknown, params: Record<string, unknown>, context: ImageOperatorCompileContext): number {
  const { optionValues } = choiceSchema(binding, context);
  const selected = resolveImageOperatorChoiceValue(binding, params, context);
  return optionValues.indexOf(selected);
}
