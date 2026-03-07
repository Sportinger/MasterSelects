import type { ToolDefinition } from '../types';

export const maskToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getMasks',
      description: 'Get all masks for a clip with full vertex details including bezier handles.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addRectangleMask',
      description: 'Add a rectangle mask to a clip. Covers 80% of the clip area, centered.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addEllipseMask',
      description: 'Add an ellipse mask to a clip. Covers 80% of the clip area, centered.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addMask',
      description: 'Add a custom mask with vertices (normalized 0-1 coordinates). Vertices define the mask shape.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          name: { type: 'string', description: 'Mask name' },
          vertices: {
            type: 'array',
            description: 'Array of vertices with {x, y} in 0-1 normalized coords. Optional handleIn/handleOut for bezier curves.',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X position (0-1)' },
                y: { type: 'number', description: 'Y position (0-1)' },
                handleIn: { type: 'object', description: '{x, y} bezier handle in', properties: { x: { type: 'number' }, y: { type: 'number' } } },
                handleOut: { type: 'object', description: '{x, y} bezier handle out', properties: { x: { type: 'number' }, y: { type: 'number' } } },
              },
              required: ['x', 'y'],
            },
          },
          closed: { type: 'boolean', description: 'Close the mask path (default: true)' },
          feather: { type: 'number', description: 'Edge feather amount (default: 0)' },
          opacity: { type: 'number', description: 'Mask opacity 0-1 (default: 1)' },
          inverted: { type: 'boolean', description: 'Invert mask (default: false)' },
          mode: { type: 'string', description: 'Mask mode: add, subtract, intersect, difference (default: add)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeMask',
      description: 'Remove a mask from a clip.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
        },
        required: ['clipId', 'maskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateMask',
      description: 'Update mask properties: feather, featherQuality, opacity, inverted, mode, position, visible, closed.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
          name: { type: 'string', description: 'New mask name' },
          feather: { type: 'number', description: 'Edge feather amount (0+)' },
          featherQuality: { type: 'number', description: 'Feather quality 1-100 (1-33=low, 34-66=medium, 67-100=high)' },
          opacity: { type: 'number', description: 'Mask opacity 0-1' },
          inverted: { type: 'boolean', description: 'Invert mask' },
          mode: { type: 'string', description: 'Mask mode: add, subtract, intersect, difference' },
          visible: { type: 'boolean', description: 'Show/hide mask' },
          closed: { type: 'boolean', description: 'Close/open mask path' },
          positionX: { type: 'number', description: 'Mask position offset X (normalized 0-1)' },
          positionY: { type: 'number', description: 'Mask position offset Y (normalized 0-1)' },
        },
        required: ['clipId', 'maskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addVertex',
      description: 'Add a vertex to an existing mask. Coordinates are normalized 0-1. Optional bezier handles for curves.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
          x: { type: 'number', description: 'X position (0-1 normalized)' },
          y: { type: 'number', description: 'Y position (0-1 normalized)' },
          handleInX: { type: 'number', description: 'Bezier handle-in X offset (default: 0)' },
          handleInY: { type: 'number', description: 'Bezier handle-in Y offset (default: 0)' },
          handleOutX: { type: 'number', description: 'Bezier handle-out X offset (default: 0)' },
          handleOutY: { type: 'number', description: 'Bezier handle-out Y offset (default: 0)' },
          index: { type: 'number', description: 'Insert at this index (default: append at end)' },
        },
        required: ['clipId', 'maskId', 'x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeVertex',
      description: 'Remove a vertex from a mask by vertex ID.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
          vertexId: { type: 'string', description: 'The vertex ID (from getMasks)' },
        },
        required: ['clipId', 'maskId', 'vertexId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateVertex',
      description: 'Update a vertex position and/or bezier handles. Only provided properties are changed.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
          vertexId: { type: 'string', description: 'The vertex ID (from getMasks)' },
          x: { type: 'number', description: 'New X position (0-1 normalized)' },
          y: { type: 'number', description: 'New Y position (0-1 normalized)' },
          handleInX: { type: 'number', description: 'Bezier handle-in X offset' },
          handleInY: { type: 'number', description: 'Bezier handle-in Y offset' },
          handleOutX: { type: 'number', description: 'Bezier handle-out X offset' },
          handleOutY: { type: 'number', description: 'Bezier handle-out Y offset' },
        },
        required: ['clipId', 'maskId', 'vertexId'],
      },
    },
  },
];
