import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';

/** Full simulation differential: identity-dependent spawning, neighbors, trails and persistence. */
export async function checkOrderedSessions(device: GPUDevice) {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 257, shape: 'grid', size: [12, 10, 4], lifetime: 0.1, respawn: true, initialSpeed: 3 });
  const simulation = b.add('flock.simulation', { minSpeed: 0, maxSpeed: 20, stepRate: '60' });
  const rules = b.add('flock.rules');
  const compose = b.add('flock.compose');
  const fluid = b.add('flock.fluid', { size: [16, 16, 8], cellSize: 2, iterations: 12 });
  const points = b.add('flock.render-points');
  const trails = b.add('flock.trails', { sampleFraction: 1, maxTrails: 30, samples: 8, interval: 1 });
  const curves = b.add('flock.render-curves');
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', simulation, 'spawn').connect(rules, 'behavior', compose, 'behavior')
    .connect(fluid, 'behavior', compose, 'behavior').connect(compose, 'behavior', simulation, 'behavior').connect(simulation, 'particles', points, 'particles')
    .connect(points, 'scene', output, 'scene').connect(simulation, 'particles', trails, 'particles')
    .connect(trails, 'curves', curves, 'curves').connect(curves, 'scene', output, 'scene');
  const compiled = compileFlockDefinition(b.build('ordered GPU test'));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const pipelines = new FlockGpuPipelines(device), context = { keyframesByProperty: indexFlockKeyframes([]) };
  const canonical = new FlockGpuSession(device, pipelines, compiled.program, context, { spatialOrder: false });
  const sorted = new FlockGpuSession(device, pipelines, compiled.program, context);
  const imported = new FlockGpuSession(device, pipelines, compiled.program, context);
  const sessions = [canonical, sorted, imported];
  sessions.forEach(session => { session.checkpointInterval = 4; });
  const compare = (a: Float32Array, c: Float32Array, label: string) => {
    if (a.length !== c.length) throw new Error(`${label}: length mismatch`);
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(c[i]) || Math.abs(a[i] - c[i]) > 1e-5) throw new Error(`${label}/${i}: ${a[i]} != ${c[i]}`);
  };
  try {
    for (const step of [1, 4, 5, 9, 12]) {
      canonical.advanceTo(step, 24); sorted.advanceTo(step, 24);
      compare(await canonical.sampleParticles(257), await sorted.sampleParticles(257), `step ${step}`);
      compare(await canonical.sampleParticles(257, 'previous'), await sorted.sampleParticles(257, 'previous'), `interpolation ${step}`);
    }
    const expected = await canonical.sampleParticles(257);
    const expectedPrevious = await canonical.sampleParticles(257, 'previous');
    const a = await canonical.readCheckpoint(8), c = await sorted.readCheckpoint(8);
    if (!a || !c) throw new Error('Missing checkpoint');
    compare(new Float32Array(a.state), new Float32Array(c.state), 'checkpoint state');
    for (let i = 0; i < a.rings.length; i++) compare(new Float32Array(a.rings[i]), new Float32Array(c.rings[i]), `trail ${i}`);
    sorted.advanceTo(8, 24); sorted.advanceTo(12, 24);
    compare(expected, await sorted.sampleParticles(257), 'rewind/replay');
    compare(expectedPrevious, await sorted.sampleParticles(257, 'previous'), 'rewind interpolation');
    if (!imported.importCheckpoint(8, c.state, c.rings)) throw new Error('Import failed');
    imported.seekCheckpoint(8); imported.advanceTo(12, 24);
    compare(expected, await imported.sampleParticles(257), 'persisted import');
    compare(expectedPrevious, await imported.sampleParticles(257, 'previous'), 'import interpolation');
    imported.clearCheckpoints();
    if (imported.adoptCheckpoints(sorted, [8]) !== 1) throw new Error('Adoption failed');
    imported.advanceTo(8, 24); imported.advanceTo(12, 24);
    compare(expected, await imported.sampleParticles(257), 'adopted replay');
    compare(expectedPrevious, await imported.sampleParticles(257, 'previous'), 'adoption interpolation');
    return { orderedSession: 'matched', count: 257, steps: 12, interpolation: true, respawn: true, neighbors: true, trails: true, checkpoint: 'restore/import/adopt' };
  } finally { sessions.forEach(session => session.dispose()); }
}
