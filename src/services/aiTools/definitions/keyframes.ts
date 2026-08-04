import type { ToolDefinition } from '../types';

const keyframeSequenceItemSchema = {
  type: 'object',
  properties: {
    clipId: { type: 'string', description: 'The clip ID.' },
    property: { type: 'string', description: 'An exact animatable property path returned for this clip.' },
    value: { type: 'number', description: 'Value in the property descriptor\'s authoring unit.' },
    time: { type: 'number', description: 'Clip-local time in seconds. Defaults to the playhead relative to this clip.' },
    easing: { type: 'string', description: 'linear, ease-in, ease-out, ease-in-out, bezier, or a supported legacy alias.' },
  },
  required: ['clipId', 'property', 'value'],
};

const LEGACY_KEYFRAME_SCHEMA_FIELDS = ['clipId', 'property', 'value', 'time', 'easing'];

const addKeyframeParameters = {
  type: 'object' as const,
  properties: {
    clipId: { type: 'string', description: 'The clip ID' },
    property: { type: 'string', description: 'Property to animate: transform/speed paths or any animatable Motion Design path returned by getMotionDesign (for example shape.size.w or appearance.{id}.opacity).' },
    value: { type: 'number', description: 'Value at this keyframe. Units match setTransform: 2D position.x/y/z use centered composition pixels, effective-3D/camera positions use scene units, scale.* uses a multiplier (1 = 100%), rotation.* uses degrees, opacity uses 0-1, and speed uses a multiplier.' },
    time: { type: 'number', description: 'Time in seconds relative to clip start. If omitted, uses current playhead position relative to clip.' },
    easing: { type: 'string', description: 'Easing: linear, ease-in, ease-out, ease-in-out, bezier. Legacy aliases like easeOut are also accepted (default: ease-in-out).' },
    sequence: {
      type: 'array',
      minItems: 1,
      description: 'Atomic multi-keyframe mode. Every item is prevalidated and the full sequence is committed as one undo step.',
      items: keyframeSequenceItemSchema,
    },
  },
  required: [],
  oneOf: [
    {
      required: ['clipId', 'property', 'value'],
      not: { required: ['sequence'] },
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
      description: 'Get all keyframes for a clip, optionally filtered by property.',
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
      description: 'Add one keyframe with the legacy clipId/property/value fields, or atomically author a keyframe sequence of any required size. Use exactly one mode. Times are relative to each clip start (0 = clip start).',
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
