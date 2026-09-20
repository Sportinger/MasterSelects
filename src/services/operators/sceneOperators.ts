import type { OperatorDefinition, OperatorParameter, OperatorPort, OperatorSignal } from '../../types/operatorGraph';

const port = (id: string, type: OperatorSignal, label = id): OperatorPort => ({ id, type, label });
const number = (id: string, label: string, value: number, min: number, max: number): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step: 0.01, animatable: false });
const op = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[], parameters: OperatorParameter[] = [], addable = true): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters, runtime: 'builtin', invalidates: 'appearance', addable });

export const SCENE_OPERATORS: readonly OperatorDefinition[] = [
  op('image.frame', 'Video / image frame', 'The current decoded source frame, shared by every connected texture.', [], [port('image', 'image', 'Frame')], [], false),
  op('texture.image', 'Image texture', 'Uploads the connected frame as a reusable GPU texture.', [port('image', 'image', 'Frame'), port('uv', 'uv', 'UV mapping')], [port('texture', 'texture', 'Texture')]),
  op('texture.uv', 'UV transform', 'Scale and offset source UV coordinates. Chained UV transforms compose in connection order.', [port('uv', 'uv', 'UV')], [port('uv', 'uv', 'UV')], [
    number('scaleU', 'Scale U', 1, -10, 10), number('scaleV', 'Scale V', 1, -10, 10), number('offsetU', 'Offset U', 0, -10, 10), number('offsetV', 'Offset V', 0, -10, 10),
  ]),
  op('material.surface', 'Surface material', 'Texture with RGB tint and opacity. Without a texture, uses a solid color.', [port('texture', 'texture', 'Color texture')], [port('material', 'material', 'Material')], [
    number('red', 'Red', 1, 0, 2), number('green', 'Green', 1, 0, 2), number('blue', 'Blue', 1, 0, 2), number('opacity', 'Opacity', 1, 0, 1),
  ]),
  op('geometry.plane', 'Plane geometry', 'A rectangular surface sized relative to the source image. Material UVs are independent of its size.', [], [port('geometry', 'geometry', 'Geometry')], [number('width', 'Width', 1, 0.01, 10), number('height', 'Height', 1, 0.01, 10)]),
  op('geometry.source', 'Source geometry', 'Uses the saved face/depth/cable geometry of this clip, or its image plane when there is no bake.', [], [port('geometry', 'geometry', 'Geometry')]),
  op('scene.mesh', 'Mesh', 'Combines connected geometry and material. A disconnected geometry or material produces no object.', [port('geometry', 'geometry', 'Geometry'), port('material', 'material', 'Material')], [port('scene', 'scene', 'Object')]),
  op('scene.clip-transform', '3D transform', 'Applies the clip transform and its keyframes to the connected object.', [port('scene', 'scene', 'Object')], [port('scene', 'scene', 'World space')], [], false),
  op('scene.render', '3D render', 'Renders the connected object with the timeline camera and lights. Disconnect to mute the object.', [port('scene', 'scene', 'Scene')], [port('image', 'image', 'Rendered image')], [], false),
];
