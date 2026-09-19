import {
  PRODUCT_ANALYTICS_CHECKOUT_FAILURE_STAGES,
  PRODUCT_ANALYTICS_EXPORT_FAILURE_STAGES,
  PRODUCT_ANALYTICS_FAILURE_CODES,
  PRODUCT_ANALYTICS_MEDIA_IMPORT_FAILURE_STAGES,
  PRODUCT_ANALYTICS_PROJECT_FAILURE_STAGES,
} from './failureClassification';

export type ProductAnalyticsPropertyRule =
  | {
      kind: 'boolean';
    }
  | {
      integer?: boolean;
      kind: 'number';
      maximum: number;
      minimum: number;
    }
  | {
      allowed?: readonly string[];
      kind: 'string';
      maximumLength: number;
      pattern?: RegExp;
    };

export interface ProductAnalyticsEventDefinition {
  properties: Readonly<Record<string, ProductAnalyticsPropertyRule>>;
}

export const PRODUCT_ANALYTICS_EDIT_ACTIONS = [
  'add',
  'adjust',
  'animate',
  'apply',
  'bake',
  'bypass',
  'clear',
  'connect',
  'create',
  'cut',
  'delete',
  'disable',
  'disconnect',
  'duplicate',
  'edit',
  'enable',
  'extract',
  'fit',
  'group',
  'lift',
  'link',
  'mark',
  'move',
  'nudge',
  'paste',
  'remove',
  'rename',
  'reorder',
  'replace',
  'resize',
  'reset',
  'restore',
  'retime',
  'ripple_delete',
  'ripple_trim',
  'roll',
  'rotate',
  'set',
  'slide',
  'slip',
  'soften',
  'split',
  'sync',
  'toggle',
  'trim',
  'unbake',
  'unlink',
  'update',
  'upgrade',
  'use',
  'other',
] as const;

export const PRODUCT_ANALYTICS_EDIT_OPERATIONS = [
  'add',
  'delete',
  'trim',
  'timing',
  'visual',
  'audio',
  'animation',
  'text',
  'storyboard',
  'music',
  'organize',
  'other',
] as const;

export const PRODUCT_ANALYTICS_EDIT_ORIGINS = ['user', 'agent'] as const;

export const PRODUCT_ANALYTICS_EDIT_TARGETS = [
  'adjustment',
  'audio',
  'camera',
  'caption',
  'clip',
  'color',
  'composition',
  'dock',
  'effect',
  'fade',
  'hook',
  'keyframe',
  'light',
  'mask',
  'material',
  'media',
  'midi',
  'model',
  'motion_path',
  'node',
  'panel',
  'project',
  'scene',
  'spectral_layer',
  'stem',
  'text',
  'track',
  'transcript',
  'transform',
  'transition',
  'other',
] as const;

export const PRODUCT_ANALYTICS_CONTROL_AREAS = [
  'audio',
  'camera',
  'caption',
  'color',
  'effect',
  'light',
  'mask',
  'model',
  'motion',
  'node',
  'text',
  'transform',
  'transition',
  'other',
] as const;

export const PRODUCT_ANALYTICS_CONTROL_INTERACTIONS = [
  'add',
  'change',
  'disable',
  'enable',
  'remove',
  'reorder',
  'reset',
  'toggle',
] as const;

export type ProductAnalyticsEditAction = typeof PRODUCT_ANALYTICS_EDIT_ACTIONS[number];
export type ProductAnalyticsEditOperation = typeof PRODUCT_ANALYTICS_EDIT_OPERATIONS[number];
export type ProductAnalyticsEditOrigin = typeof PRODUCT_ANALYTICS_EDIT_ORIGINS[number];
export type ProductAnalyticsEditTarget = typeof PRODUCT_ANALYTICS_EDIT_TARGETS[number];
export type ProductAnalyticsControlArea = typeof PRODUCT_ANALYTICS_CONTROL_AREAS[number];
export type ProductAnalyticsControlInteraction = typeof PRODUCT_ANALYTICS_CONTROL_INTERACTIONS[number];

const identifier = (maximumLength = 80): ProductAnalyticsPropertyRule => ({
  kind: 'string',
  maximumLength,
  pattern: /^[a-z0-9][a-z0-9._:-]*$/i,
});

const choice = (allowed: readonly string[]): ProductAnalyticsPropertyRule => ({
  allowed,
  kind: 'string',
  maximumLength: Math.max(...allowed.map((value) => value.length)),
});

const count = (maximum = 100_000): ProductAnalyticsPropertyRule => ({
  integer: true,
  kind: 'number',
  maximum,
  minimum: 0,
});

const durationBucket = choice([
  'under_1s',
  '1_5s',
  '5_15s',
  '15_60s',
  '1_5m',
  '5_15m',
  '15m_plus',
] as const);

const exportProperties = {
  container: identifier(24),
  duration_bucket: choice(['under_10s', '10_60s', '1_5m', '5_30m', '30m_plus'] as const),
  encoder: identifier(32),
  fps_bucket: choice(['under_24', '24_30', '31_60', 'over_60'] as const),
  kind: choice(['video', 'audio', 'gif', 'still', 'image_sequence', 'fcpxml'] as const),
  resolution_bucket: choice(['sd', 'hd', 'fhd', 'qhd', 'uhd', 'over_uhd'] as const),
  run_id: identifier(80),
  runtime_bucket: durationBucket,
} as const satisfies Readonly<Record<string, ProductAnalyticsPropertyRule>>;

export const PRODUCT_ANALYTICS_EVENT_DEFINITIONS = {
  landing_viewed: {
    properties: {
      entry_source: choice(['direct', 'navigation', 'return'] as const),
    },
  },
  landing_option_selected: {
    properties: {
      experience: choice(['editor', 'chat', 'medium'] as const),
      mode: choice(['easy', 'medium', 'hard'] as const),
    },
  },
  app_opened: {
    properties: {
      build_id: identifier(32),
      acquisition_campaign: identifier(64),
      acquisition_content: identifier(64),
      acquisition_medium: choice([
        'community',
        'email',
        'organic-social',
        'referral',
        'social',
        'video',
      ] as const),
      acquisition_source: choice([
        'bluesky',
        'discord',
        'facebook',
        'instagram',
        'linkedin',
        'reddit',
        'threads',
        'tiktok',
        'x',
        'youtube',
      ] as const),
      device_class: choice(['desktop', 'tablet', 'mobile'] as const),
      experience: choice(['editor', 'chat', 'medium'] as const),
      language: identifier(16),
      platform: choice(['windows', 'macos', 'linux', 'ios', 'android', 'other'] as const),
    },
  },
  analytics_preference_changed: {
    properties: {
      enabled: { kind: 'boolean' },
    },
  },
  setup_started: {
    properties: {},
  },
  setup_background_selected: {
    properties: {
      background: choice(['premiere', 'davinci', 'finalcut', 'aftereffects', 'beginner'] as const),
    },
  },
  setup_completed: {
    properties: {
      background: choice(['premiere', 'davinci', 'finalcut', 'aftereffects', 'beginner'] as const),
    },
  },
  setup_cancelled: {
    properties: {
      stage: choice(['background', 'confirmation'] as const),
    },
  },
  tutorial_started: {
    properties: {
      step_count: count(500),
      tutorial_id: identifier(),
    },
  },
  tutorial_step_viewed: {
    properties: {
      step_count: count(500),
      step_id: identifier(),
      step_index: count(500),
      tutorial_id: identifier(),
    },
  },
  tutorial_completed: {
    properties: {
      step_count: count(500),
      tutorial_id: identifier(),
    },
  },
  tutorial_skipped: {
    properties: {
      step_count: count(500),
      step_index: count(500),
      tutorial_id: identifier(),
    },
  },
  tutorial_cancelled: {
    properties: {
      step_count: count(500),
      step_index: count(500),
      tutorial_id: identifier(),
    },
  },
  project_created: {
    properties: {
      backend: choice(['fsa', 'native'] as const),
      runtime_bucket: durationBucket,
    },
  },
  project_opened: {
    properties: {
      backend: choice(['fsa', 'native'] as const),
      runtime_bucket: durationBucket,
      source: choice(['picker', 'browser_storage'] as const),
    },
  },
  project_closed: {
    properties: {
      backend: choice(['fsa', 'native'] as const),
    },
  },
  project_action_failed: {
    properties: {
      action: choice(['create', 'open', 'save'] as const),
      backend: choice(['fsa', 'native'] as const),
      failure_code: choice(PRODUCT_ANALYTICS_FAILURE_CODES),
      failure_stage: choice(PRODUCT_ANALYTICS_PROJECT_FAILURE_STAGES),
      reason: choice(['cancelled', 'storage_error', 'unknown'] as const),
      runtime_bucket: durationBucket,
    },
  },
  media_import_started: {
    properties: {
      audio_count: count(),
      file_count: count(),
      image_count: count(),
      other_count: count(),
      size_bucket: choice(['zero', 'under_10mb', '10_100mb', '100mb_1gb', '1_10gb', '10gb_plus'] as const),
      source: choice(['input_or_drop', 'picker', 'handles'] as const),
      video_count: count(),
    },
  },
  media_import_completed: {
    properties: {
      imported_count: count(),
      requested_count: count(),
      runtime_bucket: durationBucket,
      source: choice(['input_or_drop', 'picker', 'handles'] as const),
    },
  },
  media_import_failed: {
    properties: {
      failure_code: choice(PRODUCT_ANALYTICS_FAILURE_CODES),
      failure_stage: choice(PRODUCT_ANALYTICS_MEDIA_IMPORT_FAILURE_STAGES),
      requested_count: count(),
      runtime_bucket: durationBucket,
      source: choice(['input_or_drop', 'picker', 'handles'] as const),
    },
  },
  media_import_cancelled: {
    properties: {
      source: choice(['picker'] as const),
    },
  },
  timeline_edit_committed: {
    properties: {
      action: choice(PRODUCT_ANALYTICS_EDIT_ACTIONS),
      operation: choice(PRODUCT_ANALYTICS_EDIT_OPERATIONS),
      origin: choice(PRODUCT_ANALYTICS_EDIT_ORIGINS),
      target: choice(PRODUCT_ANALYTICS_EDIT_TARGETS),
    },
  },
  editor_control_committed: {
    properties: {
      area: choice(PRODUCT_ANALYTICS_CONTROL_AREAS),
      control_id: identifier(80),
      control_kind: choice(['button', 'checkbox', 'drag', 'number', 'select', 'slider', 'toggle'] as const),
      input_method: choice(['click', 'drag', 'keyboard', 'reset', 'select', 'type'] as const),
      interaction: choice(PRODUCT_ANALYTICS_CONTROL_INTERACTIONS),
      item_id: identifier(80),
      item_kind: choice(['audio_effect', 'effect', 'property', 'preset', 'other'] as const),
    },
  },
  editor_surface_viewed: {
    properties: {
      surface: identifier(48),
    },
  },
  timeline_history_used: {
    properties: {
      action: choice(['undo', 'redo', 'restore'] as const),
    },
  },
  playback_started: {
    properties: {
      speed_bucket: choice(['reverse', 'slow', 'normal', 'fast'] as const),
    },
  },
  playback_stopped: {
    properties: {
      reason: choice(['pause', 'stop', 'ended'] as const),
      runtime_bucket: durationBucket,
    },
  },
  panel_opened: {
    properties: {
      panel: identifier(48),
    },
  },
  pricing_viewed: {
    properties: {},
  },
  checkout_started: {
    properties: {
      plan: identifier(32),
    },
  },
  checkout_redirected: {
    properties: {
      plan: identifier(32),
    },
  },
  checkout_failed: {
    properties: {
      failure_code: choice(PRODUCT_ANALYTICS_FAILURE_CODES),
      failure_stage: choice(PRODUCT_ANALYTICS_CHECKOUT_FAILURE_STAGES),
      plan: identifier(32),
    },
  },
  checkout_returned: {
    properties: {
      plan: identifier(32),
    },
  },
  export_started: {
    properties: exportProperties,
  },
  export_completed: {
    properties: exportProperties,
  },
  export_failed: {
    properties: {
      ...exportProperties,
      error_category: choice(['codec', 'memory', 'media', 'permission', 'cancelled', 'unknown'] as const),
      failure_code: choice(PRODUCT_ANALYTICS_FAILURE_CODES),
      failure_stage: choice(PRODUCT_ANALYTICS_EXPORT_FAILURE_STAGES),
    },
  },
  export_cancelled: {
    properties: exportProperties,
  },
} as const satisfies Readonly<Record<string, ProductAnalyticsEventDefinition>>;

export type ProductAnalyticsEventName = keyof typeof PRODUCT_ANALYTICS_EVENT_DEFINITIONS;
export type ProductAnalyticsProperties = Record<string, boolean | number | string>;

export function isProductAnalyticsEventName(value: unknown): value is ProductAnalyticsEventName {
  return typeof value === 'string' && value in PRODUCT_ANALYTICS_EVENT_DEFINITIONS;
}

function sanitizeProperty(
  value: unknown,
  rule: ProductAnalyticsPropertyRule,
): boolean | number | string | undefined {
  if (rule.kind === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (rule.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const bounded = Math.max(rule.minimum, Math.min(rule.maximum, value));
    return rule.integer ? Math.round(bounded) : bounded;
  }

  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, rule.maximumLength);
  if (!normalized) return undefined;
  if (rule.allowed && !rule.allowed.includes(normalized)) return undefined;
  if (rule.pattern && !rule.pattern.test(normalized)) return undefined;
  return normalized;
}

export function sanitizeProductAnalyticsProperties(
  eventName: ProductAnalyticsEventName,
  properties: unknown,
): ProductAnalyticsProperties {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  const definition = PRODUCT_ANALYTICS_EVENT_DEFINITIONS[eventName];
  const input = properties as Record<string, unknown>;
  const sanitized: ProductAnalyticsProperties = {};

  for (const [propertyName, rule] of Object.entries(definition.properties)) {
    const value = sanitizeProperty(input[propertyName], rule);
    if (value !== undefined) sanitized[propertyName] = value;
  }

  return sanitized;
}
