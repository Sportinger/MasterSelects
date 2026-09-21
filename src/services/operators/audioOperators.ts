import type { OperatorDefinition, OperatorPort } from '../../types/operatorGraph';
import { IMAGE_OPERATORS } from './imageOperators';
import { SAMPLE_MATH_OPERATIONS } from './scalarOperationSemantics';

/** The same scalar operations are lifted over samples; no audio-specific math formulas. */
export const AUDIO_MATH_FAMILIES = new Set(SAMPLE_MATH_OPERATIONS.map(operation => `math.${operation}`));
export const AUDIO_SCALAR_OPERATORS = IMAGE_OPERATORS.filter(operator => operator.variant === 'scalar'
  && AUDIO_MATH_FAMILIES.has(operator.family ?? ''));
const port = (id: string, direction: 'input' | 'output'): OperatorPort => ({ id, label: 'Audio', type: 'audio', required: direction === 'input' });
const stage = (id: string, label: string, inputs: OperatorPort[], outputs: OperatorPort[]): OperatorDefinition => ({
  id, label, description: 'Channel-preserving audio samples at the current sample rate.', version: 1,
  inputs, outputs, parameters: [], invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'inline',
  consumers: ['audio'], implementation: 'shared',
});

export const AUDIO_OPERATORS: readonly OperatorDefinition[] = [
  stage('audio.input', 'Audio Input', [], [port('audio', 'output')]),
  stage('audio.output', 'Audio Output', [port('audio', 'input')], []),
  ...AUDIO_SCALAR_OPERATORS.flatMap(scalar => Array.from({ length: (1 << scalar.inputs.length) - 1 }, (_, index) => {
    const mask = index + 1;
    const signature = scalar.inputs.map((_, i) => mask & (1 << i) ? 'audio' : 'scalar').join('-');
    return { ...scalar, id: `${scalar.family}.${signature}`, variant: signature,
      description: `${scalar.label} applied independently to every audio sample and channel. Scalar inputs broadcast to all samples.`,
      inputs: scalar.inputs.map((input, i) => ({ ...input, type: mask & (1 << i) ? 'audio' as const : input.type })),
      outputs: scalar.outputs.map(output => ({ ...output, type: 'audio' as const })), consumers: ['audio'], implementation: 'shared' as const };
  })),
];
