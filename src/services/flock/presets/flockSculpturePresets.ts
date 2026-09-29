import type { FlockDefinition, FlockVec3 } from '../../../types/flock';
import { FlockGraphBuilder } from './flockGraphBuilder';

/** Overlapping, independently offset curl fields add naturally in shared regions. */
function addLocalFlows(b: FlockGraphBuilder, compose: string): void {
  const positions: FlockVec3[] = [[-55, 50, -20], [35, 55, -20], [-55, -25, -20], [45, -30, -20], [0, 5, -20], [0, -65, -20]];
  positions.forEach((position, i) => {
    const flow = b.add('flock.curl-flow', {
      center: position, radius: 100, offset: [i * 17.3 + 4.1, i * -11.7, i * 23.9],
      strength: 60, frequency: 0.021 + i * 0.002, evolution: 0.07 + i * 0.019, detail: 0.15,
    }, [-520, 420 + i * 160], `Local curl ${i + 1}`);
    b.connect(flow, 'behavior', compose, 'behavior');
    b.expose(flow, 'strength', 'Local Flows', `Flow ${i + 1} Strength`);
  });
}

/** A low-gravity sheet that develops overlapping flows from a calm initial state. */
export function createSculpturePreset(variant: 'terracotta' | 'lilac'): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', {
    count: 524288, shape: 'grid', size: [190, 190, 0.4],
    center: [0, 0, -20], initialSpeed: 0, seed: 17, gridJitter: 0.6,
  }, [-780, -180], 'Dense sheet');
  const flow = b.add('flock.curl-flow', {
    strength: 20, frequency: 0.012, evolution: 0.045, detail: 0.15,
  }, [-780, 40], 'Slow folding flow');
  const home = b.add('flock.home', { stiffness: 0.45 }, [-780, 220], 'Soft restoring pull');
  const drag = b.add('flock.drag', { amount: 1.4 }, [-780, 340]);
  const fluid = b.add('flock.fluid', {
    center: [0, 0, -15], size: [190, 190, 170], cellSize: 6,
    gravity: [0, -8, 0], affineStrength: 0.85, iterations: 12,
    separationStrength: 0.15, separationDistance: 0.1, jitter: 0.002,
  }, [-520, 220], 'Low-gravity APIC');
  const compose = b.add('flock.compose', {}, [-280, 40]);
  const simulation = b.add('flock.simulation', {
    stepRate: '60', minSpeed: 0, maxSpeed: 30, maxAcceleration: 180, warmup: 0,
  }, [-40, -180]);
  const colors = variant === 'terracotta'
    ? ['#a53a20', '#ee7139', '#f6ceb0', '#fff0dd']
    : ['#372035', '#865779', '#d4a9c7', '#f6e2ee'];
  const palette = b.add('flock.palette', {
    mode: 'position', frequency: 0.018,
    color1: colors[0], color2: colors[1], color3: colors[2], color4: colors[3],
  }, [-40, 120], 'Broad pigment regions');
  const points = b.add('flock.render-points', {
    shape: 'soft', size: 6, sizeVariance: 0.08, sizeMode: 'screen',
    colorMode: 'palette', opacity: 1, distanceFade: 0, children: 16,
    shading: 'lit', blend: 'opaque',
  }, [220, -180], 'Granular surface');
  const room = b.add('flock.render-room', {
    center: [0, 0, -40], size: [190, 190, 110], frame: 10,
    color: '#f1e8e3', lightDirection: [-0.45, 0.8, 0.65],
    ambient: 0.62, shadowStrength: 0.6, cornerShade: 0.3, shadows: true,
  }, [220, 120], 'Gallery box');
  const output = b.add('flock.output', {}, [480, -80]);
  b.connect(emitter, 'spawn', simulation, 'spawn');
  for (const node of [flow, home, drag, fluid]) b.connect(node, 'behavior', compose, 'behavior');
  addLocalFlows(b, compose);
  b.connect(compose, 'behavior', simulation, 'behavior')
    .connect(simulation, 'particles', points, 'particles')
    .connect(palette, 'palette', points, 'palette')
    .connect(points, 'scene', output, 'scene').connect(room, 'scene', output, 'scene');
  b.expose(flow, 'strength', 'Motion', 'Flow Strength')
    .expose(flow, 'frequency', 'Motion', 'Fold Frequency')
    .expose(flow, 'evolution', 'Motion', 'Flow Evolution')
    .expose(home, 'stiffness', 'Motion', 'Rest Pull')
    .expose(drag, 'amount', 'Motion', 'Damping')
    .expose(simulation, 'warmup', 'Motion', 'Pre-roll')
    .expose(emitter, 'count', 'Surface', 'Simulated Particles')
    .expose(points, 'children', 'Surface', 'Sub-particles')
    .expose(points, 'size', 'Surface', 'Grain Size')
    .expose(room, 'ambient', 'Lighting', 'Ambient')
    .expose(room, 'shadowStrength', 'Lighting', 'Shadow Strength');
  for (let i = 1; i <= 4; i++) b.expose(palette, `color${i}`, 'Pigment', `Color ${i}`);
  return b.build(`sculpture-${variant}`);
}
