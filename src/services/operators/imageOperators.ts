import type { OperatorDefinition, OperatorPort } from '../../types/operatorGraph';

const port = (id: string, type: OperatorPort['type'], label: string, required = false): OperatorPort =>
  ({ id, type, label, required });

const imageOperator = (definition: Omit<OperatorDefinition, 'version' | 'invalidates' | 'runtime' | 'state' | 'fusion'>): OperatorDefinition => ({
  ...definition,
  version: 1,
  invalidates: 'appearance',
  runtime: 'builtin',
  state: 'stateless',
  fusion: 'inline',
});

const vectorOperators = ([2, 3, 4] as const).flatMap(size => {
  const type = `vec${size}` as 'vec2' | 'vec3' | 'vec4';
  const components = ['x', 'y', 'z', 'w'].slice(0, size);
  return [
    imageOperator({ id: `vector.split.${type}`, family: 'vector.split', variant: type, label: `Split ${type.toUpperCase()}`, description: `Separates ${size} ordered vector components.`,
      inputs: [port('value', type, 'Value', true)], outputs: components.map(id => port(id, 'number', id.toUpperCase())), parameters: [], addable: true }),
    imageOperator({ id: `vector.combine.${type}`, family: 'vector.combine', variant: type, label: `Combine ${type.toUpperCase()}`, description: `Combines ${size} scalars into one ordered vector.`,
      inputs: components.map(id => port(id, 'number', id.toUpperCase(), true)), outputs: [port('value', type, 'Value')], parameters: [], addable: true }),
  ];
});

/** Operators newly owned by the local image compiler. image.frame and values.number stay canonical registry entries. */
export const IMAGE_OPERATORS: readonly OperatorDefinition[] = [
  ...vectorOperators,
  imageOperator({ id: 'convert.image-to-vec4', label: 'Image to RGBA', description: 'Adapts one sampled image pixel to a four-component value.',
    inputs: [port('image', 'image', 'Image', true)], outputs: [port('value', 'vec4', 'RGBA')], parameters: [], addable: true }),
  imageOperator({ id: 'convert.vec4-to-image', label: 'RGBA to Image', description: 'Adapts a four-component value to one image pixel.',
    inputs: [port('value', 'vec4', 'RGBA', true)], outputs: [port('image', 'image', 'Image')], parameters: [], addable: true }),
  imageOperator({ id: 'vector.split.rgba', label: 'Split RGB + Alpha', description: 'Structurally separates an RGBA image value into source-encoded RGB and straight alpha.',
    inputs: [port('image', 'image', 'Image', true)], outputs: [port('rgb', 'rgb', 'RGB'), port('alpha', 'alpha', 'Alpha')], parameters: [], addable: true }),
  imageOperator({ id: 'vector.combine.rgba', label: 'Combine RGB + Alpha', description: 'Structurally combines RGB and alpha as an RGBA image value.',
    inputs: [port('rgb', 'rgb', 'RGB', true), port('alpha', 'alpha', 'Alpha', true)], outputs: [port('image', 'image', 'Image')], parameters: [], addable: true }),
  imageOperator({ id: 'math.subtract.scalar', family: 'math.subtract', variant: 'scalar', label: 'Subtract', description: 'Subtracts scalar B from scalar A. This typed variant does not alias scalar-field math.',
    inputs: [port('a', 'number', 'A', true), port('b', 'number', 'B', true)], outputs: [port('value', 'number', 'Value')], parameters: [], addable: true, bypass: 'mute' }),
  imageOperator({ id: 'math.subtract.rgb', family: 'math.subtract', variant: 'rgb', label: 'Subtract', description: 'Component-wise RGB subtraction in the shared subtract family. Bypass passes B through.',
    inputs: [port('a', 'rgb', 'A', true), port('b', 'rgb', 'B', true)], outputs: [port('value', 'rgb', 'Value')], parameters: [], addable: true, bypass: 'mute' }),
  imageOperator({ id: 'math.add.rgb', family: 'math.add', variant: 'rgb', label: 'Add', description: 'Component-wise RGB addition preserving source color encoding.',
    inputs: [port('a', 'rgb', 'A', true), port('b', 'rgb', 'B', true)], outputs: [port('value', 'rgb', 'Value')], parameters: [], addable: true, bypass: 'passthrough' }),
  imageOperator({ id: 'math.multiply.rgb', family: 'math.multiply', variant: 'rgb', label: 'Multiply', description: 'Component-wise RGB multiplication preserving source color encoding.',
    inputs: [port('a', 'rgb', 'A', true), port('b', 'rgb', 'B', true)], outputs: [port('value', 'rgb', 'Value')], parameters: [], addable: true, bypass: 'passthrough' }),
  imageOperator({ id: 'math.clamp.rgb', family: 'math.clamp', variant: 'rgb', label: 'Clamp', description: 'Clamps each RGB component between the connected minimum and maximum.',
    inputs: [port('value', 'rgb', 'Value', true), port('min', 'rgb', 'Min', true), port('max', 'rgb', 'Max', true)], outputs: [port('value', 'rgb', 'Value')], parameters: [], addable: true, bypass: 'passthrough' }),
  imageOperator({ id: 'math.mix.rgb', family: 'math.mix', variant: 'rgb', label: 'Mix', description: 'Linearly interpolates or extrapolates between RGB A and B using scalar T. Bypass passes B through.',
    inputs: [port('a', 'rgb', 'A', true), port('b', 'rgb', 'B', true), port('t', 'number', 'T', true)], outputs: [port('value', 'rgb', 'Value')], parameters: [], addable: true, bypass: 'passthrough' }),
  imageOperator({ id: 'color.luminance-rec601.rgb', family: 'color.luminance-rec601', variant: 'rgb', label: 'Rec.601 Luminance',
    description: 'Computes 0.299 R + 0.587 G + 0.114 B directly in the source color encoding.',
    inputs: [port('rgb', 'rgb', 'RGB', true)], outputs: [port('value', 'number', 'Luminance')], parameters: [], addable: true }),
  imageOperator({ id: 'convert.scalar-to-rgb', label: 'Scalar to RGB', description: 'Replicates one scalar into three RGB components.',
    inputs: [port('value', 'number', 'Value', true)], outputs: [port('rgb', 'rgb', 'RGB')], parameters: [], addable: true }),
  // Read-only migration definitions. migrateImageOperatorGraph removes them before canonical persistence/compilation.
  imageOperator({ id: 'image.rgb-split', label: 'Legacy Split RGB + Alpha', description: 'Migrates to vector.split.rgba.',
    inputs: [port('image', 'image', 'Image', true)], outputs: [port('rgb', 'rgb', 'RGB'), port('alpha', 'alpha', 'Alpha')], parameters: [], addable: false }),
  imageOperator({ id: 'image.rgb-combine', label: 'Legacy Combine RGB + Alpha', description: 'Migrates to vector.combine.rgba.',
    inputs: [port('rgb', 'rgb', 'RGB', true), port('alpha', 'alpha', 'Alpha', true)], outputs: [port('image', 'image', 'Image')], parameters: [], addable: false }),
  imageOperator({ id: 'color.invert.rgb', label: 'Legacy RGB Invert', description: 'Migrates to scalar one, RGB splat and typed subtract.',
    inputs: [port('rgb', 'rgb', 'RGB', true)], outputs: [port('rgb', 'rgb', 'RGB')], parameters: [], addable: false, bypass: 'mute' }),
  imageOperator({ id: 'image.output', label: 'Image Output', description: 'Selects the image produced by this local graph.',
    inputs: [port('image', 'image', 'Image', true)], outputs: [], parameters: [], addable: false }),
];
