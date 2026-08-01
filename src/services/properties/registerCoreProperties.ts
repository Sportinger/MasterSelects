
import type { PropertyRegistry } from './PropertyRegistry';
import { propertyRegistry } from './PropertyRegistry';
import { registerTransformProperties } from './transformProperties';
import {
  getEffectDescriptorForPath,
  getEffectDescriptorsForClip,
  registerEffectTemplates,
} from './effectProperties';
import {
  getAudioEffectDescriptorForPath,
  getAudioEffectDescriptorsForClip,
} from './audioEffectProperties';
import { getColorDescriptorForPath, getColorDescriptorsForClip } from './colorProperties';
import { getMaskDescriptorForPath, getMaskDescriptorsForClip } from './maskProperties';
import { getVectorDescriptorForPath, getVectorDescriptorsForClip } from './vectorAnimationProperties';
import { getMotionDescriptorForPath, getMotionDescriptorsForClip } from './motionDesignProperties';

export function registerCoreProperties(registry: PropertyRegistry = propertyRegistry): PropertyRegistry {
  registerTransformProperties(registry);
  registerEffectTemplates(registry);
  registry.registerResolver('effect-instance', getEffectDescriptorForPath);
  registry.registerProvider('effect-instance', getEffectDescriptorsForClip);
  registry.registerResolver('audio-effect-instance', getAudioEffectDescriptorForPath);
  registry.registerProvider('audio-effect-instance', getAudioEffectDescriptorsForClip);
  registry.registerResolver('color-correction', getColorDescriptorForPath);
  registry.registerProvider('color-correction', getColorDescriptorsForClip);
  registry.registerResolver('mask', getMaskDescriptorForPath);
  registry.registerProvider('mask', getMaskDescriptorsForClip);
  registry.registerResolver('vector-animation', getVectorDescriptorForPath);
  registry.registerProvider('vector-animation', getVectorDescriptorsForClip);
  registry.registerResolver('motion-design', getMotionDescriptorForPath);
  registry.registerProvider('motion-design', getMotionDescriptorsForClip);
  return registry;
}
