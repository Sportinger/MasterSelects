import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';

export function neighborFixture(kind: 'none' | 'rules' | 'links' | 'disconnected', count = 257) {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count, shape: 'grid', size: [4, 4, 2], initialSpeed: 0 });
  const simulation = b.add('flock.simulation', { minSpeed: 0, maxSpeed: 20, stepRate: '60' });
  const fluid = b.add('flock.fluid', { size: [12, 12, 8], cellSize: 2, gravity: [0, 0, 0] });
  const render = b.add(kind === 'links' ? 'flock.render-links' : 'flock.render-points', { sampleFraction: 1, radius: 3, perParticle: 2 });
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', simulation, 'spawn').connect(simulation, 'particles', render, 'particles').connect(render, 'scene', output, 'scene');
  if (kind === 'rules') {
    const rules = b.add('flock.rules', { cohesion: 0, separation: 0, alignment: 0 });
    const compose = b.add('flock.compose');
    b.connect(rules, 'behavior', compose, 'behavior').connect(fluid, 'behavior', compose, 'behavior').connect(compose, 'behavior', simulation, 'behavior');
  } else {
    b.connect(fluid, 'behavior', simulation, 'behavior');
    if (kind === 'disconnected') b.add('flock.rules');
  }
  const compiled = compileFlockDefinition(b.build(`neighbor ${kind}`));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.program;
}
