import type { FlockDefinition } from '../../../types/flock';
import { FlockGraphBuilder } from './flockGraphBuilder';

export interface FlockPresetDescriptor {
  id: string;
  label: string;
  description: string;
  showcase?: boolean;
  create(): FlockDefinition;
}

const COL = { pop: -760, beh: -460, sim: -160, ren: 160, out: 460 } as const;

function exposeCore(builder: FlockGraphBuilder, ids: { emitter: string; rules: string; sim: string; turbulence?: string }) {
  builder
    .expose(ids.emitter, 'count', 'Population', 'Population')
    .expose(ids.rules, 'cohesion', 'Behavior')
    .expose(ids.rules, 'separation', 'Behavior')
    .expose(ids.rules, 'alignment', 'Behavior')
    .expose(ids.sim, 'maxSpeed', 'Behavior', 'Speed');
  if (ids.turbulence) builder.expose(ids.turbulence, 'strength', 'Behavior', 'Turbulence');
}

function freeSwarm(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 4000, shape: 'sphere', size: [70, 70, 70] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', {}, [COL.beh, -160]);
  const turbulence = b.add('flock.turbulence', { strength: 18 }, [COL.beh, 0]);
  const boundary = b.add('flock.boundary', { shape: 'sphere', size: [120, 120, 120], mode: 'contain' }, [COL.beh, 200]);
  const compose = b.add('flock.compose', {}, [COL.beh + 160, -80]);
  const sim = b.add('flock.simulation', {}, [COL.sim, 0]);
  const points = b.add('flock.render-points', { size: 5, color: '#9fd8ff', opacity: 0.95 }, [COL.ren, 0]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn')
    .connect(rules, 'behavior', compose, 'behavior')
    .connect(turbulence, 'behavior', compose, 'behavior')
    .connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', points, 'particles')
    .connect(points, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim, turbulence });
  b.expose(points, 'size', 'Appearance').expose(points, 'color', 'Appearance');
  return b.build('free-swarm');
}

function krillCloud(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 6000, shape: 'box', size: [180, 70, 120] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { alignment: 2.2, cohesion: 0.8, separation: 1.8, neighborRadius: 10 }, [COL.beh, -220]);
  const cluster = b.add('flock.cluster', { clusters: 5, spread: 60, strength: 6 }, [COL.beh, -60]);
  const turbulence = b.add('flock.turbulence', { strength: 10, frequency: 0.015 }, [COL.beh, 100]);
  const drag = b.add('flock.drag', { amount: 0.25 }, [COL.beh, 240]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const boundary = b.add('flock.boundary', { shape: 'box', size: [320, 160, 240], mode: 'contain' }, [COL.beh, 380]);
  const sim = b.add('flock.simulation', { maxSpeed: 38, minSpeed: 10 }, [COL.sim, 0]);
  const bodies = b.add('flock.render-instances', { mesh: 'krill', size: 1.8, color: '#ff9b7a' }, [COL.ren, -120]);
  const links = b.add('flock.render-links', { radius: 9, sampleFraction: 0.12, opacity: 0.25 }, [COL.ren, 60]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn');
  for (const behavior of [rules, cluster, turbulence, drag]) b.connect(behavior, 'behavior', compose, 'behavior');
  b.connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', bodies, 'particles')
    .connect(sim, 'particles', links, 'particles')
    .connect(bodies, 'scene', output, 'scene')
    .connect(links, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim, turbulence });
  b.expose(bodies, 'size', 'Appearance').expose(bodies, 'color', 'Appearance')
    .expose(links, 'sampleFraction', 'Lines', 'Line Density');
  return b.build('krill-cloud');
}

function vortex(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 5000, shape: 'shell', size: [90, 30, 90] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.6 }, [COL.beh, -160]);
  const vortexNode = b.add('flock.vortex', { strength: 45, radius: 160, inwardPull: 0.2 }, [COL.beh, 0]);
  const cruise = b.add('flock.cruise', { speed: 30 }, [COL.beh, 160]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const boundary = b.add('flock.boundary', { shape: 'sphere', size: [170, 170, 170], mode: 'contain' }, [COL.beh, 320]);
  const sim = b.add('flock.simulation', {}, [COL.sim, 0]);
  const points = b.add('flock.render-points', { size: 4.5, color: '#b9f3ff', colorMode: 'speed', opacity: 0.95 }, [COL.ren, -80]);
  const vectors = b.add('flock.render-vectors', { sampleFraction: 0.06 }, [COL.ren, 100]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn')
    .connect(rules, 'behavior', compose, 'behavior')
    .connect(vortexNode, 'behavior', compose, 'behavior')
    .connect(cruise, 'behavior', compose, 'behavior')
    .connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', points, 'particles')
    .connect(sim, 'particles', vectors, 'particles')
    .connect(points, 'scene', output, 'scene')
    .connect(vectors, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim });
  b.expose(vortexNode, 'strength', 'Guidance', 'Vortex Strength')
    .expose(points, 'size', 'Appearance').expose(points, 'color', 'Appearance');
  return b.build('vortex');
}

function followPath(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 3000, shape: 'sphere', size: [40, 40, 40], center: [0, 0, 0] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.9, alignment: 1.6 }, [COL.beh, -180]);
  const path = b.add('flock.path', { shape: 'figure8', radius: 110, height: 40, rotation: [90, 0, 0] }, [COL.beh - 200, 60]);
  const follow = b.add('flock.follow-path', { strength: 28, tubeRadius: 16 }, [COL.beh, 40]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const sim = b.add('flock.simulation', { maxSpeed: 55 }, [COL.sim, 0]);
  const trails = b.add('flock.trails', { sampleFraction: 0.12, samples: 32, interval: 2 }, [COL.ren - 100, 140]);
  const curves = b.add('flock.render-curves', { color: '#8ff5c8', width: 1.2 }, [COL.ren + 60, 140]);
  const points = b.add('flock.render-points', { size: 4, color: '#e8fff6', opacity: 0.95 }, [COL.ren, -80]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn')
    .connect(path, 'path', follow, 'path')
    .connect(rules, 'behavior', compose, 'behavior')
    .connect(follow, 'behavior', compose, 'behavior')
    .connect(compose, 'behavior', sim, 'behavior')
    .connect(sim, 'particles', points, 'particles')
    .connect(sim, 'particles', trails, 'particles')
    .connect(trails, 'curves', curves, 'curves')
    .connect(points, 'scene', output, 'scene')
    .connect(curves, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim });
  b.expose(follow, 'strength', 'Guidance', 'Path Strength')
    .expose(points, 'size', 'Appearance').expose(points, 'color', 'Appearance')
    .expose(trails, 'sampleFraction', 'Lines', 'Trail Density');
  return b.build('follow-path');
}

function technicalNetwork(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 2500, shape: 'sphere', size: [90, 60, 90] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.7, separation: 2, neighborRadius: 16, separationRadius: 7 }, [COL.beh, -160]);
  const turbulence = b.add('flock.turbulence', { strength: 14 }, [COL.beh, 0]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, -60]);
  const boundary = b.add('flock.boundary', { shape: 'box', size: [260, 180, 220], mode: 'reflect' }, [COL.beh, 180]);
  const sim = b.add('flock.simulation', { maxSpeed: 30 }, [COL.sim, 0]);
  const points = b.add('flock.render-points', { shape: 'dot', size: 3.5, color: '#e6f4ff', opacity: 1 }, [COL.ren, -200]);
  const links = b.add('flock.render-links', { radius: 15, perParticle: 3, sampleFraction: 0.5, opacity: 0.6, width: 1.2, color: '#6fd3ff' }, [COL.ren, -40]);
  const trails = b.add('flock.trails', { sampleFraction: 0.04, samples: 16, interval: 4 }, [COL.ren - 120, 140]);
  const glyphs = b.add('flock.render-glyphs', { glyph: 'square', anchor: 'trail-head', size: 7, sampleFraction: 0.5 }, [COL.ren + 60, 140]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn')
    .connect(rules, 'behavior', compose, 'behavior')
    .connect(turbulence, 'behavior', compose, 'behavior')
    .connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', points, 'particles')
    .connect(sim, 'particles', links, 'particles')
    .connect(sim, 'particles', trails, 'particles')
    .connect(trails, 'curves', glyphs, 'curves')
    .connect(points, 'scene', output, 'scene')
    .connect(links, 'scene', output, 'scene')
    .connect(glyphs, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim, turbulence });
  b.expose(points, 'size', 'Appearance').expose(links, 'color', 'Appearance', 'Line Color')
    .expose(links, 'sampleFraction', 'Lines', 'Line Density');
  return b.build('technical-network');
}

/** Showcase A: one hero animal, clustered swarm, technical lines for a camera pullback. */
function shrimpPullback(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const hero = b.add('flock.emitter', { count: 1, shape: 'point', group: 1, seed: 3, initialSpeed: 12 }, [COL.pop, -260], 'Hero');
  const swarm = b.add('flock.emitter', { count: 24000, shape: 'box', size: [420, 180, 420], seed: 11 }, [COL.pop, -60], 'Swarm');
  const merge = b.add('flock.merge-spawn', {}, [COL.pop + 200, -160]);
  const rules = b.add('flock.rules', { alignment: 2, cohesion: 0.7, separation: 1.7, neighborRadius: 9, separationRadius: 3 }, [COL.beh, -260]);
  const cluster = b.add('flock.cluster', { clusters: 14, spread: 190, wander: 0.08, strength: 7, radius: 90 }, [COL.beh, -100]);
  const turbulence = b.add('flock.turbulence', { strength: 9, frequency: 0.01 }, [COL.beh, 60]);
  const heroSelect = b.add('flock.select-group', { group: 1 }, [COL.beh - 220, 240]);
  const heroAttract = b.add('flock.attractor', { position: [0, 0, 0], strength: 40, radius: 400, falloff: 'none' }, [COL.beh, 220], 'Hero Anchor');
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const boundary = b.add('flock.boundary', { shape: 'box', size: [700, 320, 700], mode: 'contain', softness: 60 }, [COL.beh, 380]);
  const sim = b.add('flock.simulation', { maxSpeed: 32, minSpeed: 9 }, [COL.sim, 0]);
  const swarmSelect = b.add('flock.select-group', { group: 0 }, [COL.sim, 260]);
  const bodies = b.add('flock.render-instances', { mesh: 'krill', size: 1.5, color: '#ffae8f', swimAmplitude: 0.3 }, [COL.ren, -300], 'Swarm Bodies');
  const heroBody = b.add('flock.render-instances', { mesh: 'krill', size: 9, color: '#ffc4a8', swimAmplitude: 0.18, swimFrequency: 2 }, [COL.ren, -160], 'Hero Body');
  const links = b.add('flock.render-links', { radius: 8, perParticle: 2, sampleFraction: 0.08, maxLinks: 30000, opacity: 0.18, color: '#9fe7ff' }, [COL.ren, 0]);
  const trails = b.add('flock.trails', { sampleFraction: 0.02, maxTrails: 600, samples: 40, interval: 3 }, [COL.ren - 140, 180]);
  const curves = b.add('flock.render-curves', { color: '#8fd9ff', width: 1, opacity: 0.45 }, [COL.ren + 60, 160]);
  const glyphs = b.add('flock.render-glyphs', { glyph: 'ring', size: 5, sampleFraction: 0.25, opacity: 0.7 }, [COL.ren + 60, 300]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(hero, 'spawn', merge, 'spawn').connect(swarm, 'spawn', merge, 'spawn').connect(merge, 'spawn', sim, 'spawn')
    .connect(heroSelect, 'selection', heroAttract, 'selection');
  for (const behavior of [rules, cluster, turbulence, heroAttract]) b.connect(behavior, 'behavior', compose, 'behavior');
  b.connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', bodies, 'particles')
    .connect(swarmSelect, 'selection', bodies, 'selection')
    .connect(sim, 'particles', heroBody, 'particles')
    .connect(heroSelect, 'selection', heroBody, 'selection')
    .connect(sim, 'particles', links, 'particles')
    .connect(sim, 'particles', trails, 'particles')
    .connect(trails, 'curves', curves, 'curves')
    .connect(trails, 'curves', glyphs, 'curves');
  for (const branch of [bodies, heroBody, links, curves, glyphs]) b.connect(branch, 'scene', output, 'scene');
  exposeCore(b, { emitter: swarm, rules, sim, turbulence });
  b.expose(bodies, 'size', 'Appearance', 'Body Size').expose(bodies, 'color', 'Appearance', 'Body Color')
    .expose(links, 'sampleFraction', 'Lines', 'Line Density')
    .expose(links, 'opacity', 'Lines', 'Line Opacity');
  return b.build('shrimp-pullback');
}

/** Showcase B: dense violet clusters, long curved filaments and sparse geometric markers. */
function violetFilaments(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 20000, shape: 'sphere', size: [150, 120, 150], seed: 5 }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.5, separation: 1.2, alignment: 0.9, neighborRadius: 8, separationRadius: 2.5 }, [COL.beh, -240]);
  const cluster = b.add('flock.cluster', { clusters: 12, spread: 110, wander: 0.12, strength: 10, radius: 45 }, [COL.beh, -80]);
  const turbulence = b.add('flock.turbulence', { strength: 16, frequency: 0.03, evolution: 0.2 }, [COL.beh, 80]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const boundary = b.add('flock.boundary', { shape: 'sphere', size: [230, 230, 230], mode: 'contain' }, [COL.beh, 240]);
  const sim = b.add('flock.simulation', { maxSpeed: 26, minSpeed: 5 }, [COL.sim, 0]);
  const palette = b.add('flock.palette', { mode: 'position', frequency: 0.012 }, [COL.sim + 120, -260]);
  const points = b.add('flock.render-points', { size: 3.4, colorMode: 'palette', opacity: 0.8, distanceFade: 0.6 }, [COL.ren, -260]);
  const trails = b.add('flock.trails', { sampleFraction: 0.03, maxTrails: 700, samples: 56, interval: 2, salt: 13 }, [COL.ren - 150, -40]);
  const curves = b.add('flock.render-curves', { colorMode: 'palette', width: 1.1, taper: 0.05, opacity: 0.7 }, [COL.ren + 60, -60]);
  const glyphs = b.add('flock.render-glyphs', { glyph: 'cube', anchor: 'trail-head', size: 4, sizeMode: 'world', sampleFraction: 0.18, color: '#f3d9ff', opacity: 0.85 }, [COL.ren + 60, 100]);
  const tails = b.add('flock.render-glyphs', { glyph: 'dot', anchor: 'trail-tail', size: 3, sampleFraction: 0.35, color: '#c890ff', opacity: 0.6 }, [COL.ren + 60, 240]);
  const output = b.add('flock.output', {}, [COL.out, 0]);
  b.connect(emitter, 'spawn', sim, 'spawn');
  for (const behavior of [rules, cluster, turbulence]) b.connect(behavior, 'behavior', compose, 'behavior');
  b.connect(compose, 'behavior', sim, 'behavior')
    .connect(boundary, 'boundary', sim, 'boundary')
    .connect(sim, 'particles', points, 'particles')
    .connect(palette, 'palette', points, 'palette')
    .connect(sim, 'particles', trails, 'particles')
    .connect(trails, 'curves', curves, 'curves')
    .connect(palette, 'palette', curves, 'palette')
    .connect(trails, 'curves', glyphs, 'curves')
    .connect(trails, 'curves', tails, 'curves');
  for (const branch of [points, curves, glyphs, tails]) b.connect(branch, 'scene', output, 'scene');
  exposeCore(b, { emitter, rules, sim, turbulence });
  b.expose(palette, 'color1', 'Appearance', 'Deep Violet')
    .expose(palette, 'color2', 'Appearance', 'Violet')
    .expose(trails, 'sampleFraction', 'Lines', 'Filament Density')
    .expose(glyphs, 'sampleFraction', 'Lines', 'Marker Density');
  return b.build('violet-filaments');
}

export const FLOCK_PRESETS: readonly FlockPresetDescriptor[] = [
  { id: 'free-swarm', label: 'Free Swarm', description: 'Boids with turbulence inside a soft sphere.', create: freeSwarm },
  { id: 'krill-cloud', label: 'Krill Cloud', description: 'Aligned krill bodies in drifting clusters with faint neighbor links.', create: krillCloud },
  { id: 'vortex', label: 'Vortex', description: 'A swirling shell of particles with velocity strokes.', create: vortex },
  { id: 'follow-path', label: 'Follow Path', description: 'A school following a figure-eight with trails.', create: followPath },
  { id: 'technical-network', label: 'Technical Network', description: 'Points, neighbor links and square markers.', create: technicalNetwork },
  { id: 'shrimp-pullback', label: 'Shrimp Pullback (Showcase)', description: 'Hero animal inside an immense structured swarm with technical lines.', showcase: true, create: shrimpPullback },
  { id: 'violet-filaments', label: 'Violet Filaments (Showcase)', description: 'Clustered violet mass with curved filaments and geometric endpoints.', showcase: true, create: violetFilaments },
];

export const DEFAULT_FLOCK_PRESET_ID = 'free-swarm';

export function getFlockPreset(presetId: string): FlockPresetDescriptor | undefined {
  return FLOCK_PRESETS.find((preset) => preset.id === presetId);
}

export function createFlockPresetDefinition(presetId: string = DEFAULT_FLOCK_PRESET_ID): FlockDefinition {
  return (getFlockPreset(presetId) ?? getFlockPreset(DEFAULT_FLOCK_PRESET_ID)!).create();
}
