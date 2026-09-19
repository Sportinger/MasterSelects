import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { EFFECT_REGISTRY } from './index';
import type { EffectControlProps } from './types';

// Definitions are registered synchronously. Create stable component identities
// before rendering either inspector; lazy still defers each module's import
// until its controls are first displayed.
const extraControls: Record<string, LazyExoticComponent<ComponentType<EffectControlProps>> | undefined> = Object.create(null);
for (const [id, effect] of EFFECT_REGISTRY) {
  if ('extraControls' in effect && effect.extraControls) {
    extraControls[id] = lazy(effect.extraControls);
  }
}

export const EXTRA_CONTROLS_REGISTRY: Readonly<typeof extraControls> = Object.freeze(extraControls);
