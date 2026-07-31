import type { ToolDefinition } from '../types';

const hexColorSchema = {
  type: 'string',
  description: 'Hex color using #RGB, #RRGGBB, or #RRGGBBAA.',
};

const fillSchema = {
  type: 'object',
  description: 'Primary color-fill changes. Omitted fields preserve their current values.',
  properties: {
    enabled: { type: 'boolean', description: 'Show or hide the primary fill.' },
    color: hexColorSchema,
    opacity: { type: 'number', description: 'Fill opacity from 0 to 1.' },
  },
  required: [],
};

const strokeSchema = {
  type: 'object',
  description: 'Primary stroke changes. A missing stroke is created when any stroke field is supplied.',
  properties: {
    enabled: { type: 'boolean', description: 'Show or hide the primary stroke.' },
    color: hexColorSchema,
    opacity: { type: 'number', description: 'Stroke opacity from 0 to 1.' },
    width: { type: 'number', description: 'Stroke width in pixels from 0 to 10000.' },
    alignment: {
      type: 'string',
      enum: ['center', 'inside', 'outside'],
      description: 'Stroke alignment relative to the shape edge.',
    },
  },
  required: [],
};

const gradientStopSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Existing stable stop id when preserving a stop during replacement. Omit to create a new id.',
    },
    offset: { type: 'number', description: 'Stop position from 0 to 1.' },
    color: hexColorSchema,
  },
  required: ['offset', 'color'],
};

const vectorSchema = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: [],
};

const appearanceOperationSchema = {
  type: 'object',
  description: 'Ordered appearance-stack operation. add requires kind; all other operations require itemId. index is zero-based.',
  properties: {
    operation: {
      type: 'string',
      enum: ['add', 'update', 'remove', 'move', 'duplicate', 'set-visibility', 'show', 'hide'],
    },
    itemId: { type: 'string', description: 'Stable appearance id returned by getMotionDesign.' },
    kind: {
      type: 'string',
      enum: ['color-fill', 'stroke', 'linear-gradient', 'radial-gradient'],
    },
    index: { type: 'integer', description: 'Zero-based destination/insertion index.' },
    name: { type: 'string' },
    visible: { type: 'boolean' },
    opacity: { type: 'number', description: 'Appearance opacity from 0 to 1.' },
    blendMode: {
      type: 'string',
      enum: ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference'],
    },
    color: hexColorSchema,
    width: { type: 'number', description: 'Stroke width in pixels.' },
    alignment: {
      type: 'string',
      enum: ['center', 'inside', 'outside'],
    },
    stops: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: gradientStopSchema,
    },
    start: vectorSchema,
    end: vectorSchema,
    center: vectorSchema,
    radius: {
      type: 'number',
      description: 'Radial-gradient radius in normalized shape coordinates.',
    },
  },
  required: ['operation'],
};

export const motionDesignToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getMotionCapabilities',
      description: 'List the Motion Design features, Transform property descriptors, and renderer limits that are actually available. Supply a motion-shape clip id to include all clip-valid registry-backed Motion and Transform paths with current authoring values.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'Optional motion-shape clip id for clip-specific property descriptors.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMotionDesign',
      description: 'Read a motion-shape clip, its stable appearance ids, current Grid Replicator state, renderer-effective instance count, and editable Motion plus Transform property descriptors.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createMotionShapeClip',
      description: 'Create a native editable Motion Design rectangle, ellipse, polygon, or star on an unlocked video track. Omitted timing uses the playhead and a five-second duration.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'Unlocked video track id. Defaults to the first visible unlocked video track.',
          },
          startTime: {
            type: 'number',
            description: 'Timeline start in seconds. Defaults to the playhead.',
          },
          duration: {
            type: 'number',
            description: 'Clip duration in seconds, greater than 0.',
          },
          name: { type: 'string', description: 'Optional clip name.' },
          primitive: {
            type: 'string',
            enum: ['rectangle', 'ellipse', 'polygon', 'star'],
            description: 'Rendered shape primitive. Defaults to rectangle.',
          },
          width: {
            type: 'number',
            description: 'Shape width in pixels from 1 to 100000.',
          },
          height: {
            type: 'number',
            description: 'Shape height in pixels from 1 to 100000.',
          },
          cornerRadius: {
            type: 'number',
            description: 'Rectangle, polygon, or star corner radius in pixels from 0 to 100000.',
          },
          points: {
            type: 'integer',
            description: 'Polygon or star point count from 3 to 32.',
          },
          radius: {
            type: 'number',
            description: 'Polygon radius in pixels.',
          },
          outerRadius: {
            type: 'number',
            description: 'Star outer radius in pixels.',
          },
          innerRadius: {
            type: 'number',
            description: 'Star inner radius in pixels.',
          },
          fill: fillSchema,
          stroke: strokeSchema,
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateMotionProperties',
      description: 'Atomically update one or more clip-valid Motion or Transform property-registry paths on a motion-shape clip. Call getMotionDesign first for exact paths, authoring units, ranges, and stable appearance ids.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
          updates: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            description: 'Validated property updates applied as one clip mutation.',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'A path returned by getMotionDesign.',
                },
                value: {
                  description: 'Number, boolean, or enum value accepted by the descriptor.',
                  anyOf: [
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'string' },
                  ],
                },
              },
              required: ['path', 'value'],
            },
          },
        },
        required: ['clipId', 'updates'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateMotionAppearances',
      description: 'Edit the ordered appearance stack of a motion-shape clip. Legacy fill/stroke patches remain supported. Structured operations can add, update, remove, move, duplicate, show, or hide fills, strokes, and linear/radial gradients while preserving stable ids.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
          fill: fillSchema,
          stroke: strokeSchema,
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: appearanceOperationSchema,
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'configureMotionReplicator',
      description: 'Enable, disable, or configure the currently rendered Grid Replicator. MD0 supports up to 10 per axis and 100 effective instances.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
          enabled: { type: 'boolean', description: 'Enable or disable replication.' },
          countX: {
            type: 'integer',
            description: 'Horizontal instance count from 1 to 10.',
          },
          countY: {
            type: 'integer',
            description: 'Vertical instance count from 1 to 10.',
          },
          spacingX: {
            type: 'number',
            description: 'Horizontal center-to-center spacing in pixels.',
          },
          spacingY: {
            type: 'number',
            description: 'Vertical center-to-center spacing in pixels.',
          },
          fade: {
            type: 'number',
            description: 'Per-instance cumulative opacity multiplier from 0 to 1.',
          },
        },
        required: ['clipId'],
      },
    },
  },
];
