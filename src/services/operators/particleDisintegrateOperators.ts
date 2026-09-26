import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';
import { pixelParticleDisintegrate } from '../../effects/stylize/pixel-particle-disintegrate';

const EFFECT_PARAMS = pixelParticleDisintegrate.params;
const particles = (id = 'particles', required = false): OperatorPort =>
  ({ id, label: 'Particles', type: 'geometry', required, contract: { formats: ['pixel-particles'] } });
/** Node parameters reuse the effect's parameter IDs, so stored values and keyframes keep their owner. */
const parameters = (...ids: string[]): OperatorParameter[] => ids.map(id => {
  const spec = EFFECT_PARAMS[id];
  return { id, label: spec.label, type: spec.type === 'select' ? 'select' : 'number', default: spec.default as number | string,
    ...(spec.type === 'select' ? { options: spec.options } : { min: spec.min, max: spec.max, step: spec.step }), animatable: spec.animatable };
});
const op = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[], params: OperatorParameter[],
  options: Partial<OperatorDefinition> = {}): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters: params, runtime: 'builtin', invalidates: 'appearance',
    bypass: 'mute', addable: true, implementation: 'local', consumers: ['Pixel Particle Disintegrate'], ...options });

/** The node view of the Pixel Particle Disintegrate renderer. Gravity is the shared force operator. */
export const PARTICLE_DISINTEGRATE_OPERATORS: readonly OperatorDefinition[] = [
  op('simulation.image-particles', 'Image to Particles', 'Cuts the connected image into a grid of pixel particles that keep their source color; Cell Size sets the particle grid.',
    [{ id: 'image', label: 'Image', type: 'image', required: true }], [particles()], parameters('cellSize', 'seed'), { bypass: undefined, addable: false }),
  op('simulation.particle-release', 'Particle Release', 'Releases the particles as Progress goes from 0 to 1. Stagger and Wind Sweep spread the release over the image; mute to keep the image assembled.',
    [particles('particles', true)], [particles()], parameters('progress', 'stagger', 'windSweep', 'releaseContrast', 'tail')),
  op('simulation.particle-motion', 'Particle Motion', 'Moves released particles with the connected forces. Mute or disconnect a force to remove its motion.',
    [particles('particles', true), { id: 'forces', label: 'Forces', type: 'force', repeated: true }], [particles()], []),
  op('forces.scatter', 'Scatter', 'Pushes released particles apart: Spread scatters them in the image plane, Depth toward the camera and Spin rotates them.',
    [], [{ id: 'force', label: 'Force', type: 'force' }], parameters('spread', 'depth', 'spin')),
  op('forces.wind-gusts', 'Wind Gusts', 'Blows released particles along Direction X/Y; Gust Strength and Gust Scale add uneven wind across the image.',
    [], [{ id: 'force', label: 'Force', type: 'force' }], parameters('directionX', 'directionY', 'gustStrength', 'gustScale')),
  op('forces.curl-noise', 'Curl Noise', 'Swirls released particles through a curl noise field; Turbulence adds finer jitter.',
    [], [{ id: 'force', label: 'Force', type: 'force' }], parameters('curlStrength', 'turbulence')),
  op('render.pixel-particles', 'Particle Render', 'Draws the particles as the clip image. Mute to show the unchanged input image.',
    [particles('particles', true)], [{ id: 'image', label: 'Rendered image', type: 'image' }],
    parameters('particleSize', 'softness', 'shape', 'maxPreviewParticles', 'maxExportParticles', 'maxInstances'), { addable: false }),
];

export const PARTICLE_DISINTEGRATE_SHARED_OPERATOR_IDS = new Set(['image.frame', 'forces.gravity']);
export function isParticleDisintegrateOperator(id: string): boolean {
  return PARTICLE_DISINTEGRATE_SHARED_OPERATOR_IDS.has(id) || PARTICLE_DISINTEGRATE_OPERATORS.some(operator => operator.id === id);
}
