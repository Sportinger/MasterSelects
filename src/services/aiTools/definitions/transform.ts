import type { ToolDefinition } from '../types';
import { BLEND_MODES } from '../../../types/blendMode';

export const transformToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'setTransform',
      description: 'Set transform properties of a clip: position, scale, rotation, opacity, blend mode. Only provided properties are changed, others remain unchanged. Supports 2D and 3D/camera transform fields.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          x: { type: 'number', description: 'Horizontal position. For 2D clips: centered composition pixels (0 = center). For effective-3D and camera clips: scene units.' },
          y: { type: 'number', description: 'Vertical position. For 2D clips: centered composition pixels (0 = center, negative = up). For effective-3D and camera clips: scene units.' },
          z: { type: 'number', description: 'Depth position. For 2D clips: centered composition pixels using the horizontal extent. For effective-3D and camera clips: scene units; for cameras this is orbit distance.' },
          scaleAll: { type: 'number', description: 'Uniform scale multiplier applied on top of axis scale (1 = 100%). For camera clips this is zoom.' },
          scaleX: { type: 'number', description: 'Horizontal scale (1 = 100%)' },
          scaleY: { type: 'number', description: 'Vertical scale (1 = 100%)' },
          scaleZ: { type: 'number', description: '3D scale Z or camera forward offset, depending on clip type.' },
          rotation: { type: 'number', description: 'Legacy alias for Z-axis rotation in degrees' },
          rotationX: { type: 'number', description: 'X-axis rotation in degrees. For camera clips this is pitch.' },
          rotationY: { type: 'number', description: 'Y-axis rotation in degrees. For camera clips this is yaw.' },
          rotationZ: { type: 'number', description: 'Z-axis rotation in degrees.' },
          opacity: { type: 'number', description: 'Opacity (0 = transparent, 1 = fully visible)' },
          blendMode: { type: 'string', enum: BLEND_MODES, description: 'Clip compositing blend mode.' },
        },
        required: ['clipId'],
      },
    },
  },
];
