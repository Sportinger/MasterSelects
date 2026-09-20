import type { Effect } from '../../types/effects';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { CABLE_ANIMATED_PARAMETERS, cableProperty } from '../faceCables/cableAnimation';
import { isFaceCableConfig, type FaceCableConfig } from '../faceCables/cableData';

const configCache = new WeakMap<Effect, { settings: unknown; cables: FaceCableConfig[] }>();
function configs(effect: Effect): FaceCableConfig[] {
  const settings = effect.params.settings;
  const cached = configCache.get(effect);
  if (cached && cached.settings === settings) return cached.cables;
  let cables: FaceCableConfig[] = [];
  try {
    const value = JSON.parse(String(settings ?? '[]'));
    cables = Array.isArray(value) ? value.filter(isFaceCableConfig) : [];
  } catch { /* Invalid settings expose no cable properties. */ }
  // Each cable exposes many properties; decode shared settings once per effect.
  configCache.set(effect, { settings, cables });
  return cables;
}
/** Dynamic cable IDs are first-class properties, discoverable by timeline and atomic authoring tools. */
export function faceCableDescriptors(effect: Effect): PropertyDescriptor[] {
  if (effect.type !== 'face-cables') return [];
  return configs(effect).flatMap((cable, index) => CABLE_ANIMATED_PARAMETERS.map(key => ({
    path: cableProperty(effect.id, cable.id, key), label: `Cable ${index + 1} ${key}`,
    group: `Effects / Face Cables / Cable ${index + 1}`, valueType: 'number' as const,
    animatable: true, defaultValue: cable[key] ?? 0,
    ui: { min: key === 'windZ' ? undefined : key === 'slack' ? 1.05 : key === 'width' ? 1 : key === 'damping' ? 0.2 : 0,
      max: ['stiffness', 'viscosity', 'windGusts'].includes(key) ? 1 : undefined },
    read: clip => {
      const current = clip.effects.find(e => e.id === effect.id);
      return current ? configs(current).find(c => c.id === cable.id)?.[key] ?? 0 : undefined;
    },
    write: (clip, value) => ({ ...clip, effects: clip.effects.map(e => e.id !== effect.id ? e : {
      ...e, params: { ...e.params, settings: JSON.stringify(configs(e).map(c => c.id === cable.id ? { ...c, [key]: value } : c)) },
    }) }),
  })));
}
