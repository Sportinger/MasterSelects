import type { ToolDefinition } from '../types';

export const maskToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getMasks',
      description: 'Get all masks for a clip.',
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
      description: 'Update mask properties (feather, opacity, inverted, mode, position, visible).',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          maskId: { type: 'string', description: 'The mask ID' },
          name: { type: 'string', description: 'New mask name' },
          feather: { type: 'number', description: 'Edge feather amount' },
          opacity: { type: 'number', description: 'Mask opacity 0-1' },
          inverted: { type: 'boolean', description: 'Invert mask' },
          mode: { type: 'string', description: 'Mask mode: add, subtract, intersect, difference' },
          visible: { type: 'boolean', description: 'Show/hide mask' },
        },
        required: ['clipId', 'maskId'],
      },
    },
  },
];
