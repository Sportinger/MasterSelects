import type { ToolDefinition } from '../types';

const KEYFRAME_VALUE_DESCRIPTION = 'Absolute value at this keyframe. Units match setTransform: 2D position.x/y/z use centered composition pixels, effective-3D/camera positions use scene units, scale.* is the final source-scale multiplier (1 = native 100%) and overrides the clip base scale while active, rotation.* uses degrees, opacity uses 0-1, and speed uses a multiplier. For a punch-in on fitted/filled media, read getClipDetails and multiply its storedTransform.scale baseline; never restart at 1 unless native scale is intended.';

const FLOCK_SOURCE_TIME_DESCRIPTION = 'Flock graph parameters (flock.node.*) only: absolute simulation source time in seconds instead of time. It must lie inside the clip\'s visible source window. Flock keyframes are stored in source time, so they survive split, trim and speed changes.';

const keyframeSequenceItemSchema = {
  type: 'object',
  properties: {
    clipId: { type: 'string', description: 'The clip ID.' },
    property: { type: 'string', description: 'An exact animatable property path returned for this clip.' },
    value: { type: 'number', description: KEYFRAME_VALUE_DESCRIPTION },
    time: { type: 'number', description: 'Clip-local time in seconds. Defaults to the playhead relative to this clip.' },
    sourceTime: { type: 'number', description: FLOCK_SOURCE_TIME_DESCRIPTION },
    easing: { type: 'string', description: 'linear, ease-in, ease-out, ease-in-out, bezier, hold (keep the value until the next key), a supported legacy alias, a motion curve (sine-out, sine-in-out, cubic-in, cubic-out, cubic-in-out, expo-out, expo-in, expo-in-out, back-out, back-in) or cubic-bezier(x1, y1, x2, y2). Curves shape the segment to the next keyframe of the same property.' },
  },
  required: ['clipId', 'property', 'value'],
};

const LEGACY_KEYFRAME_SCHEMA_FIELDS = ['clipId', 'property', 'value', 'time', 'sourceTime', 'easing'];

const addKeyframeParameters = {
  type: 'object' as const,
  properties: {
    clipId: { type: 'string', description: 'The clip ID' },
    property: { type: 'string', description: 'Property to animate: transform/speed paths, any animatable Motion Design path returned by getMotionDesign (for example shape.size.w or appearance.{id}.opacity), a flock graph path returned by getFlockClip (flock.node.{nodeId}.{param}[.x|.y|.z|.r|.g|.b]), or a text clip path (text.fontSize, text.letterSpacing, …, and text.value — the number printed by {value} tokens in the text, for animated counters).' },
    value: { type: 'number', description: KEYFRAME_VALUE_DESCRIPTION },
    time: { type: 'number', description: 'Time in seconds relative to clip start. If omitted, uses current playhead position relative to clip.' },
    sourceTime: { type: 'number', description: FLOCK_SOURCE_TIME_DESCRIPTION },
    easing: { type: 'string', description: 'Easing: linear, ease-in, ease-out, ease-in-out, bezier, hold (keep the value until the next key). Legacy aliases like easeOut are also accepted (default: ease-in-out). Motion curves (expo-out, back-out, cubic-out, expo-in-out, …) or cubic-bezier(x1, y1, x2, y2) shape the segment to the next keyframe.' },
    sequence: {
      type: 'array',
      minItems: 1,
      description: 'Atomic multi-keyframe mode. Every item is prevalidated and the full sequence is committed as one undo step.',
      items: keyframeSequenceItemSchema,
    },
    effectId: { type: 'string', description: 'keys mode only: bare parameter names in keys address this effect (progress -> effect.<effectId>.progress).' },
    keys: {
      type: 'object',
      description: 'Compact atomic mode for one clip: { "<property>": [[time, value, easing?], ...], ... }, e.g. { "position.x": [[0, -300], [1.2, 200, "expo-out"]], "opacity": [[0, 0], [0.3, 1]] }. Use with clipId (and effectId for effect parameters); one undo step.',
      additionalProperties: { type: 'array' },
    },
  },
  required: [],
  oneOf: [
    {
      required: ['clipId', 'property', 'value'],
      not: { anyOf: [{ required: ['sequence'] }, { required: ['keys'] }] },
    },
    {
      required: ['clipId', 'keys'],
      not: { anyOf: [{ required: ['sequence'] }, { required: ['property'] }, { required: ['value'] }] },
    },
    {
      required: ['sequence'],
      not: {
        anyOf: LEGACY_KEYFRAME_SCHEMA_FIELDS.map((field) => ({ required: [field] })),
      },
    },
  ],
};

export const keyframeToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getKeyframes',
      description: 'Get all keyframes for a clip, optionally filtered by property. Flock graph keyframes report timeBasis "source" plus their clip-local position.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          property: { type: 'string', description: 'Filter by property name (for example position.x, opacity, speed, or a Motion Design path returned by getMotionDesign).' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addKeyframe',
      description: 'Add one keyframe with the legacy clipId/property/value fields, atomically author a keyframe sequence of any required size, or key several properties of one clip with the compact keys map. Use exactly one mode. Times are relative to each clip start (0 = clip start). Transform values are absolute final values, not multipliers relative to the clip base transform.',
      parameters: addKeyframeParameters,
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeKeyframe',
      description: 'Remove a keyframe by ID.',
      parameters: {
        type: 'object',
        properties: {
          keyframeId: { type: 'string', description: 'The keyframe ID (from getKeyframes)' },
        },
        required: ['keyframeId'],
      },
    },
  },
];
