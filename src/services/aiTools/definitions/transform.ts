import type { ToolDefinition } from '../types';

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
          x: { type: 'number', description: 'Horizontal position in pixels (0 = center, e.g. 100 = 100px right). Range depends on composition resolution.' },
          y: { type: 'number', description: 'Vertical position in pixels (0 = center, e.g. -50 = 50px up). Range depends on composition resolution.' },
          z: { type: 'number', description: '3D Z position in scene units. For camera clips this is orbit distance.' },
          scaleX: { type: 'number', description: 'Horizontal scale (1 = 100%)' },
          scaleY: { type: 'number', description: 'Vertical scale (1 = 100%)' },
          scaleZ: { type: 'number', description: '3D scale Z or camera forward offset, depending on clip type.' },
          rotation: { type: 'number', description: 'Legacy alias for Z-axis rotation in degrees' },
          rotationX: { type: 'number', description: 'X-axis rotation in degrees. For camera clips this is pitch.' },
          rotationY: { type: 'number', description: 'Y-axis rotation in degrees. For camera clips this is yaw.' },
          rotationZ: { type: 'number', description: 'Z-axis rotation in degrees.' },
          opacity: { type: 'number', description: 'Opacity (0 = transparent, 1 = fully visible)' },
          blendMode: { type: 'string', description: 'Blend mode: normal, multiply, screen, overlay, darken, lighten, colorDodge, colorBurn, hardLight, softLight, difference, exclusion' },
        },
        required: ['clipId'],
      },
    },
  },
];
