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
      description: 'Read a motion-shape clip, stable appearance ids, current Grid/Linear/Radial Replicator state and revision, renderer-effective instance count, and editable Motion plus Transform descriptors.',
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
      description: 'Create and position a native editable Motion Design rectangle, ellipse, polygon, star, or path on an unlocked video track. x/y use the same centered composition pixels as setTransform. Omitted timing uses the playhead and a five-second duration.',
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
          x: {
            type: 'number',
            description: 'Horizontal center position in composition pixels (0 = composition center).',
          },
          y: {
            type: 'number',
            description: 'Vertical center position in composition pixels (0 = composition center, negative = up).',
          },
          duration: {
            type: 'number',
            description: 'Clip duration in seconds, greater than 0.',
          },
          name: { type: 'string', description: 'Optional clip name.' },
          primitive: {
            type: 'string',
            enum: ['rectangle', 'ellipse', 'polygon', 'star', 'path'],
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
          vertices: {
            type: 'array',
            minItems: 2,
            maxItems: 128,
            description: 'Path vertices in local pixels with the origin at the shape center. Required for path primitives; 2 to 128 entries. Missing handles default to {x: 0, y: 0}.',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Vertex X in local pixels.' },
                y: { type: 'number', description: 'Vertex Y in local pixels.' },
                handleIn: {
                  ...vectorSchema,
                  description: 'Incoming handle offset from the vertex in local pixels.',
                  required: ['x', 'y'],
                },
                handleOut: {
                  ...vectorSchema,
                  description: 'Outgoing handle offset from the vertex in local pixels.',
                  required: ['x', 'y'],
                },
              },
              required: ['x', 'y'],
            },
          },
          closed: {
            type: 'boolean',
            description: 'Whether the path closes from its last vertex to its first. Defaults to false.',
          },
          trimStart: {
            type: 'number',
            description: 'Path trim start as a normalized arc-length fraction from 0 to 1. Defaults to 0.',
          },
          trimEnd: {
            type: 'number',
            description: 'Path trim end as a normalized arc-length fraction from 0 to 1. Defaults to 1 and must not be below trimStart.',
          },
          trimOffset: {
            type: 'number',
            description: 'Path trim offset as a normalized arc-length fraction from 0 to 1. Defaults to 0.',
          },
          dashLength: {
            type: 'number',
            description: 'Path dash length in pixels, greater than or equal to 0. Zero disables dashing.',
          },
          dashGap: {
            type: 'number',
            description: 'Path dash gap in pixels, greater than or equal to 0.',
          },
          dashOffset: {
            type: 'number',
            description: 'Path dash offset in pixels, greater than or equal to 0.',
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
      description: 'Atomically update one or more clip-valid Motion or Transform property-registry paths on a motion-shape clip, for example shape.size.w or shape.path.trim.start. Common shape/position paths come directly from createMotionShapeClip.commonEditablePaths; call getMotionDesign only for uncommon clip-specific paths or stable appearance ids.',
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
      name: 'saveMotionAppearancePreset',
      description: 'Save a motion-shape clip appearance stack as a named user-library preset. Texture/media fills cannot be saved.',
      parameters: { type: 'object', properties: { clipId: { type: 'string' }, name: { type: 'string' } }, required: ['clipId', 'name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listMotionAppearancePresets',
      description: 'List saved user-library motion appearance presets.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'applyMotionAppearancePreset',
      description: 'Apply a saved motion appearance preset to a motion-shape clip, replacing or appending its appearance stack.',
      parameters: { type: 'object', properties: { clipId: { type: 'string' }, presetId: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] } }, required: ['clipId', 'presetId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saveMotionTemplate',
      description: 'Capture one or up to eight rendered motion-shape clips, including appearance stacks, modifiers, keyframes, expressions, internal parent links, and texture media dependencies, as a named categorized user-library .msmotion template. Provide exactly one of clipId or clipIds.',
      parameters: { type: 'object', properties: { clipId: { type: 'string' }, clipIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 }, name: { type: 'string' }, category: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listMotionTemplates',
      description: 'List saved user-library motion clip templates and their dependency summaries.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'applyMotionTemplate',
      description: 'Instantiate one saved motion clip template onto an unlocked video track at the requested timeline time as one undoable operation. Missing texture media is reported and applied without its media binding.',
      parameters: { type: 'object', properties: { templateId: { type: 'string' }, trackId: { type: 'string' }, startTime: { type: 'number' } }, required: ['templateId', 'trackId', 'startTime'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setMotionParent',
      description: 'Atomically set or clear a 2D clip parent at the current playhead while preserving the child world transform. Cycles, missing clips, locked children, mixed 2D/3D relationships, and singular parent transforms fail closed.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['set', 'clear'],
            description: 'Set a parent or clear the current parent relationship.',
          },
          childClipId: {
            type: 'string',
            description: 'Clip whose parent relationship will change.',
          },
          parentClipId: {
            type: 'string',
            description: 'Required for operation=set and omitted for operation=clear.',
          },
        },
        required: ['operation', 'childClipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createMotionNull',
      description: 'Create one native non-rendering 2D Motion Null through the shared parent-graph transaction. Returns the new clip id, affected clip ids, and graph/state revision receipts.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'Unlocked video track for the Motion Null. Defaults to the first visible unlocked video track.',
          },
          startTime: {
            type: 'number',
            description: 'Timeline start in seconds. Defaults to the current playhead.',
          },
          duration: {
            type: 'number',
            description: 'Positive duration in seconds. Defaults to five seconds.',
          },
          name: {
            type: 'string',
            maxLength: 120,
            description: 'Optional non-empty clip name. Defaults to Null.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createMotionNullAndParent',
      description: 'Create one native Motion Null and atomically parent the specified clips to it while preserving their world transforms. The null spans the selected clips and at least the requested duration.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'Unlocked video track for the Motion Null. Defaults to the first visible unlocked video track.',
          },
          clipIds: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: { type: 'string' },
            description: 'Existing unlocked clips to parent to the new Motion Null.',
          },
          timelineTime: {
            type: 'number',
            description: 'Operation time in timeline seconds. Defaults to the current playhead.',
          },
          duration: {
            type: 'number',
            description: 'Minimum null duration in seconds. Defaults to five seconds.',
          },
        },
        required: ['clipIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editMotionAdjustment',
      description: 'Create, configure, move, trim, or remove a native Adjustment 1.0 layer as one atomic timeline edit. Configuration replaces the ordered effect list and accepts only Brightness, Contrast, Saturation, Invert, and Gaussian Blur plus the frozen blend-mode set.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'configure', 'move', 'trim', 'remove'],
          },
          expectedRevision: {
            type: 'integer',
            description: 'Optional exact timeline revision for stale-write protection.',
          },
          clipId: {
            type: 'string',
            description: 'Required for configure, move, trim, and remove.',
          },
          trackId: {
            type: 'string',
            description: 'Unlocked video track for create or move. Create defaults to the first visible unlocked video track.',
          },
          startTime: {
            type: 'number',
            description: 'Non-negative timeline start for create, move, or trim.',
          },
          duration: {
            type: 'number',
            description: 'Positive timeline duration for create or trim.',
          },
          name: {
            type: 'string',
            maxLength: 120,
            description: 'Optional create name. Defaults to Adjustment.',
          },
          opacity: {
            type: 'number',
            description: 'Adjustment mix opacity from 0 to 1 for create or configure.',
          },
          blendMode: {
            type: 'string',
            enum: ['normal', 'multiply', 'screen', 'overlay', 'add'],
            description: 'Frozen Adjustment 1.0 mix blend mode for create or configure.',
          },
          effects: {
            type: 'array',
            description: 'Ordered replacement effect list for create or configure. Omitted parameters receive frozen defaults.',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Optional stable effect id. Omit to create one.',
                },
                type: {
                  type: 'string',
                  enum: ['brightness', 'contrast', 'saturation', 'invert', 'gaussian-blur'],
                },
                enabled: { type: 'boolean' },
                parameters: {
                  type: 'object',
                  description: 'Effect parameters from the frozen compatibility matrix.',
                  properties: {
                    amount: { type: 'number' },
                    radius: { type: 'number' },
                    samples: { type: 'integer' },
                  },
                  required: [],
                },
              },
              required: ['type'],
            },
          },
        },
        required: ['operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editMotionModifier',
      description: 'Add, update, remove, reorder Motion Replicator modifiers, or set/clear its falloff. Use getMotionDesign to inspect current stacks and revisions. Modifier targets are one flat target per add/update call; further update calls accumulate targets.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['add', 'update', 'remove', 'reorder', 'set-falloff', 'clear-falloff'] }, clipId: { type: 'string' }, expectedRevision: { type: 'integer' }, modifierId: { type: 'string' }, kind: { type: 'string', enum: ['random', 'noise', 'oscillator', 'field'] }, enabled: { type: 'boolean' }, newIndex: { type: 'integer' },
          seed: { type: 'integer' }, indexFrequency: { type: 'number' }, timeFrequencyHz: { type: 'number' }, octaves: { type: 'integer' }, lacunarity: { type: 'number' }, persistence: { type: 'number' }, waveform: { type: 'string', enum: ['sine', 'triangle', 'square'] }, frequencyHz: { type: 'number' }, cyclesAcrossInstances: { type: 'number' }, phaseDegrees: { type: 'number' }, field: { type: 'string', enum: ['radial-distance'] }, centerX: { type: 'number' }, centerY: { type: 'number' }, radius: { type: 'number' }, exponent: { type: 'number' },
          targetPath: { type: 'string', enum: ['replicator.offset.position.x', 'replicator.offset.position.y', 'replicator.offset.rotation', 'replicator.offset.scale.x', 'replicator.offset.scale.y', 'replicator.offset.opacity'], description: 'Numeric Motion Replicator path to modify.' }, targetOperation: { type: 'string', enum: ['add', 'multiply'] }, targetAmount: { type: 'number' },
          falloffShapeClipId: { type: 'string' }, falloffFeather: { type: 'number', minimum: 0 }, falloffInvert: { type: 'boolean' }, falloffClip: { type: 'boolean' },
        }, required: ['operation', 'clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setMotionExpression',
      description: 'Set, replace, or remove one deterministic Motion Replicator expression binding. Expressions can use time, index, count, sin, cos, and random(seed, index); expression values replace keyframed and modifier-derived values for their target path.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
          operation: { type: 'string', enum: ['set', 'remove'] },
          path: { type: 'string', enum: ['replicator.offset.position.x', 'replicator.offset.position.y', 'replicator.offset.rotation', 'replicator.offset.scale.x', 'replicator.offset.scale.y', 'replicator.offset.opacity'] },
          source: { type: 'string', description: 'Required for operation=set.' },
          fallback: { type: 'number', description: 'Finite replacement value used if render-time evaluation fails. Defaults to 0.' },
          enabled: { type: 'boolean', description: 'Defaults to true for operation=set.' },
        },
        required: ['clipId', 'operation', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'configureMotionReplicator',
      description: 'Configure the revision-bound Grid, Linear, or Radial Motion Replicator, including terminal transform and author instance cap.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The motion-shape clip id.' },
          expectedRevision: { type: 'integer', description: 'Optional exact Replicator revision for stale-write protection.' },
          enabled: { type: 'boolean', description: 'Enable or disable replication.' },
          layoutMode: { type: 'string', enum: ['grid', 'linear', 'radial'] },
          countX: {
            type: 'integer',
            description: 'Grid column count.',
          },
          countY: {
            type: 'integer',
            description: 'Grid row count.',
          },
          spacingX: {
            type: 'number',
            description: 'Horizontal center-to-center spacing in pixels.',
          },
          spacingY: {
            type: 'number',
            description: 'Vertical center-to-center spacing in pixels.',
          },
          patternOffsetX: { type: 'number', description: 'Grid odd-row X offset.' },
          patternOffsetY: { type: 'number', description: 'Grid odd-row Y offset.' },
          count: { type: 'integer', description: 'Linear or Radial item count.' },
          stepX: { type: 'number', description: 'Linear per-index X step.' },
          stepY: { type: 'number', description: 'Linear per-index Y step.' },
          centerX: { type: 'number', description: 'Radial center X.' },
          centerY: { type: 'number', description: 'Radial center Y.' },
          radius: { type: 'number', description: 'Radial radius.' },
          startAngleDegrees: { type: 'number' },
          endAngleDegrees: { type: 'number' },
          angleSampling: { type: 'string', enum: ['inclusive-end', 'exclusive-end'] },
          autoOrient: { type: 'boolean' },
          offsetMode: { type: 'string', enum: ['cumulative', 'absolute'] },
          offsetX: { type: 'number' },
          offsetY: { type: 'number' },
          rotationDegrees: { type: 'number' },
          scaleX: { type: 'number' },
          scaleY: { type: 'number' },
          fade: {
            type: 'number',
            description: 'Per-instance cumulative opacity multiplier from 0 to 1.',
          },
          userLimit: { type: 'integer', description: 'Persisted author cap from 1 to 100000.' },
        },
        required: ['clipId'],
      },
    },
  },
];
