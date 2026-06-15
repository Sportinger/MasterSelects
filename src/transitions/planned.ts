// Planned transition metadata.
// These definitions are discoverable in dev metadata views, but never runtime-enabled.

import type { TransitionCategory, TransitionDefinition, TransitionType } from './types';

interface PlannedTransitionInput {
  id: TransitionType;
  name: string;
  category: TransitionCategory;
  description: string;
  defaultDuration?: number;
}

function plannedTransition({
  id,
  name,
  category,
  description,
  defaultDuration = 1.2,
}: PlannedTransitionInput): TransitionDefinition {
  return {
    id,
    name,
    category,
    capability: 'planned',
    defaultDuration,
    minDuration: 0.1,
    maxDuration: 5,
    description,
    recipe: [],
  };
}

export const plannedTransitions: readonly TransitionDefinition[] = [
  plannedTransition({
    id: 'smooth-cut',
    name: 'Smooth Cut',
    category: 'dissolve',
    description: 'Planned optical-flow assisted cut smoothing',
  }),
  plannedTransition({
    id: 'flow',
    name: 'Flow',
    category: 'dissolve',
    description: 'Planned motion-flow morph between adjacent clips',
  }),
  plannedTransition({
    id: 'luma-fade',
    name: 'Luma Fade',
    category: 'dissolve',
    description: 'Planned luminance-driven two-participant fade',
  }),
  plannedTransition({
    id: 'datamosh',
    name: 'Datamosh',
    category: 'glitch',
    description: 'Planned frame-history and motion-vector glitch transition',
  }),
  plannedTransition({
    id: 'signal-tear',
    name: 'Signal Tear',
    category: 'glitch',
    description: 'Planned two-participant signal tear corruption',
  }),
  plannedTransition({
    id: 'data-corrupt',
    name: 'Data Corrupt',
    category: 'glitch',
    description: 'Planned animated digital corruption transition',
  }),
  plannedTransition({
    id: 'vhs-head-switch',
    name: 'VHS Head Switch',
    category: 'glitch',
    description: 'Planned analog head-switch wobble and noise tear',
  }),
  plannedTransition({
    id: 'liquid-melt',
    name: 'Liquid Melt',
    category: 'stylize',
    description: 'Planned luminance and noise based vertical melt',
  }),
  plannedTransition({
    id: 'fly-eye',
    name: 'Fly Eye',
    category: 'stylize',
    description: 'Planned honeycomb lens-cell image sampling',
  }),
  plannedTransition({
    id: 'hex-pixelize',
    name: 'Hex Pixelize',
    category: 'pattern',
    description: 'Planned hexagonal cell resolve pattern',
  }),
  plannedTransition({
    id: 'ink-bleed',
    name: 'Ink Bleed',
    category: 'pattern',
    description: 'Planned organic ink-flow matte reveal',
  }),
  plannedTransition({
    id: 'smoke-reveal',
    name: 'Smoke Reveal',
    category: 'light',
    description: 'Planned soft smoke-flow alpha reveal',
  }),
  plannedTransition({
    id: 'portal-ring',
    name: 'Portal Ring',
    category: 'light',
    description: 'Planned glowing ring reveal with depth-safe overlay',
  }),
  plannedTransition({
    id: 'thermal-bloom',
    name: 'Thermal Bloom',
    category: 'stylize',
    description: 'Planned heat-map color ramp bloom transition',
  }),
  plannedTransition({
    id: 'shatter-glass',
    name: 'Shatter Glass',
    category: 'pattern',
    description: 'Planned seeded shard rotation and reveal',
  }),
  plannedTransition({
    id: 'cube-3d',
    name: 'Cube 3D',
    category: '3d',
    description: 'Planned cube-face shared-scene transition',
  }),
  plannedTransition({
    id: 'door-3d',
    name: 'Door 3D',
    category: '3d',
    description: 'Planned hinged panel door transition',
  }),
  plannedTransition({
    id: 'fold-3d',
    name: 'Fold 3D',
    category: '3d',
    description: 'Planned hinged fold panel transition',
  }),
  plannedTransition({
    id: 'page-peel',
    name: 'Page Peel',
    category: '3d',
    description: 'Planned mesh or strip based page peel',
  }),
  plannedTransition({
    id: 'origami-fold',
    name: 'Origami Fold',
    category: '3d',
    description: 'Planned multi-panel paper-fold transition',
  }),
  plannedTransition({
    id: 'neural-dream',
    name: 'Neural Dream',
    category: 'stylize',
    description: 'Planned AI-derived cached-frame transition',
  }),
];
