export type ModuleGate = 'draft' | 'canary' | 'required'

/**
 * Single source of truth for Playwright module promotion.
 *
 * Only modules with implemented journeys may move beyond `draft`. Keep the
 * module tag beside the gate so CLI selection never depends on directory names.
 */
export const moduleGates = {
  foundation: { gate: 'required', tag: '@module:foundation' },
  transport: { gate: 'draft', tag: '@module:transport' },
  timelineEditing: { gate: 'draft', tag: '@module:timeline-editing' },
  nestedCompositions: { gate: 'draft', tag: '@module:nested-compositions' },
  transformsKeyframes: { gate: 'draft', tag: '@module:transforms-keyframes' },
  masksEffects: { gate: 'draft', tag: '@module:masks' },
  audio: { gate: 'draft', tag: '@module:audio' },
  export: { gate: 'draft', tag: '@module:export' },
  persistenceHistory: { gate: 'draft', tag: '@module:persistence-history' },
  performanceStress: { gate: 'draft', tag: '@module:performance-stress' },
  platform: { gate: 'draft', tag: '@module:platform' },
} as const satisfies Record<string, { gate: ModuleGate; tag: `@module:${string}` }>

export type PlaywrightModule = keyof typeof moduleGates

export function modulesAtGate(gate: ModuleGate): PlaywrightModule[] {
  return (Object.keys(moduleGates) as PlaywrightModule[]).filter(
    (moduleName) => moduleGates[moduleName].gate === gate,
  )
}

export function moduleTagsAtGate(gate: ModuleGate): string[] {
  return modulesAtGate(gate).map((moduleName) => moduleGates[moduleName].tag)
}

export function moduleGrepForGate(gate: Exclude<ModuleGate, 'draft'>): RegExp {
  const tags = moduleTagsAtGate(gate)
  if (tags.length === 0) {
    // Match nothing rather than accidentally running or promoting draft tests.
    return /$a/
  }

  return new RegExp(tags.map(escapeRegExp).join('|'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
