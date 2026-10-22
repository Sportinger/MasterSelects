import type { FlockDefinition } from '../../../types/flock';
import { FlockGraphBuilder } from './flockGraphBuilder';
import { createSculpturePreset } from './flockSculpturePresets';

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
    // Speed is the simulation's Pace (the swarm flies faster or slower as a whole); a Max Speed cap
    // the steering forces never reach would leave most of its range without effect.
    .expose(ids.sim, 'pace', 'Behavior', 'Speed');
  if (ids.turbulence) builder.expose(ids.turbulence, 'strength', 'Behavior', 'Turbulence');
}

function freeSwarm(): FlockDefinition {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 4000, shape: 'sphere', size: [70, 70, 70] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', {}, [COL.beh, -160]);
  const turbulence = b.add('flock.turbulence', { strength: 18 }, [COL.beh, 0]);
  // Sphere boundaries take their radius from size[0]: 72 keeps the swarm inside the default frame.
  const boundary = b.add('flock.boundary', { shape: 'sphere', size: [72, 72, 72], mode: 'contain' }, [COL.beh, 200]);
  const compose = b.add('flock.compose', {}, [COL.beh + 160, -80]);
  const sim = b.add('flock.simulation', {}, [COL.sim, 0]);
  // Half-strength points: where the swarm crowds they add up to a bright pale blue, not clipped white.
  const points = b.add('flock.render-points', { size: 6, color: '#b4e2ff', opacity: 0.5 }, [COL.ren, 0]);
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
  const path = b.add('flock.path', { shape: 'figure8', radius: 58, height: 20, rotation: [90, 0, 0] }, [COL.beh - 200, 60]);
  const follow = b.add('flock.follow-path', { strength: 28, tubeRadius: 9 }, [COL.beh, 40]);
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
  const emitter = b.add('flock.emitter', { count: 1800, shape: 'box', size: [150, 80, 50] }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.7, separation: 2, neighborRadius: 16, separationRadius: 7 }, [COL.beh, -160]);
  const turbulence = b.add('flock.turbulence', { strength: 12 }, [COL.beh, 0]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, -60]);
  // A flat box (190 × 100 × 70) that holds the points firmly: a deeper or reflecting box let them
  // reach the camera and spread past every frame edge after a few seconds.
  const boundary = b.add('flock.boundary', { shape: 'box', size: [190, 100, 70], mode: 'contain', softness: 15, strength: 70 }, [COL.beh, 180]);
  const sim = b.add('flock.simulation', { maxSpeed: 26 }, [COL.sim, 0]);
  const points = b.add('flock.render-points', { shape: 'dot', size: 3.5, color: '#e6f4ff', opacity: 1 }, [COL.ren, -200]);
  const links = b.add('flock.render-links', { radius: 16, perParticle: 3, sampleFraction: 0.6, opacity: 0.95, width: 2.4, color: '#4fb4ff' }, [COL.ren, -40]);
  const trails = b.add('flock.trails', { sampleFraction: 0.04, samples: 16, interval: 4 }, [COL.ren - 120, 140]);
  const glyphs = b.add('flock.render-glyphs', { glyph: 'square', anchor: 'trail-head', size: 9, sampleFraction: 0.5 }, [COL.ren + 60, 140]);
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
  // Dim points in deep violets, so the cloud stays violet instead of adding up to white, in a sphere
  // that fills about half the frame; longer, wider filaments read at docs size.
  const emitter = b.add('flock.emitter', { count: 9000, shape: 'sphere', size: [100, 86, 100], seed: 5 }, [COL.pop, 0]);
  const rules = b.add('flock.rules', { cohesion: 0.5, separation: 1.2, alignment: 0.9, neighborRadius: 8, separationRadius: 2.5 }, [COL.beh, -240]);
  const cluster = b.add('flock.cluster', { clusters: 9, spread: 85, wander: 0.12, strength: 10, radius: 32 }, [COL.beh, -80]);
  const turbulence = b.add('flock.turbulence', { strength: 14, frequency: 0.03, evolution: 0.2 }, [COL.beh, 80]);
  const compose = b.add('flock.compose', {}, [COL.beh + 180, 0]);
  const boundary = b.add('flock.boundary', { shape: 'sphere', size: [104, 104, 104], mode: 'contain' }, [COL.beh, 240]);
  const sim = b.add('flock.simulation', { maxSpeed: 26, minSpeed: 5 }, [COL.sim, 0]);
  const palette = b.add('flock.palette', { mode: 'position', frequency: 0.012, color1: '#4a12a8', color2: '#9a4dff', color3: '#c98bff', color4: '#2c0b66' }, [COL.sim + 120, -260]);
  const points = b.add('flock.render-points', { size: 3.6, colorMode: 'palette', opacity: 0.45, distanceFade: 0.3 }, [COL.ren, -260]);
  const trails = b.add('flock.trails', { sampleFraction: 0.06, maxTrails: 900, samples: 60, interval: 2, salt: 13 }, [COL.ren - 150, -40]);
  const curves = b.add('flock.render-curves', { colorMode: 'palette', width: 2.6, taper: 0.3, opacity: 0.75 }, [COL.ren + 60, -60]);
  const glyphs = b.add('flock.render-glyphs', { glyph: 'cube', anchor: 'trail-head', size: 4, sizeMode: 'world', sampleFraction: 0.18, color: '#e4c4ff', opacity: 0.85 }, [COL.ren + 60, 100]);
  const tails = b.add('flock.render-glyphs', { glyph: 'dot', anchor: 'trail-tail', size: 3, sampleFraction: 0.35, color: '#b070ff', opacity: 0.6 }, [COL.ren + 60, 240]);
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
  { id: 'sculpture-terracotta', label: 'Terracotta Sculpture', description: 'Gently settling APIC sheet with slow folds, cream and orange pigment, and a lit gallery box. Calm start without pre-roll.', showcase: true, create: () => createSculpturePreset('terracotta') },
  { id: 'sculpture-lilac', label: 'Lilac Sculpture', description: 'Gently settling APIC sheet with slow folds, lilac pigment, and a lit gallery box. Calm start without pre-roll.', showcase: true, create: () => createSculpturePreset('lilac') },
  { id: 'free-swarm', label: 'Free Swarm', description: 'Fine pale points that flock together and drift apart, like starlings or dust in a beam of light.', create: freeSwarm },
  { id: 'krill-cloud', label: 'Krill Cloud', description: 'Thousands of small orange krill that swim in step and gather in drifting clusters.', create: krillCloud },
  { id: 'vortex', label: 'Vortex', description: 'A swirling shell of particles with velocity strokes.', create: vortex },
  { id: 'follow-path', label: 'Follow Path', description: 'A school that swims a figure eight and draws its path as fine trails.', create: followPath },
  { id: 'technical-network', label: 'Technical Network', description: 'Points joined to their neighbours by thin lines, with small square markers: a data sculpture.', create: technicalNetwork },
  { id: 'shrimp-pullback', label: 'Shrimp Pullback', description: 'Hero animal inside an immense structured swarm with technical lines.', showcase: true, create: shrimpPullback },
  { id: 'violet-filaments', label: 'Violet Filaments', description: 'A dense violet cloud in clusters, with long curved filaments and small wire cubes at their tips.', showcase: true, create: violetFilaments },
];

export const DEFAULT_FLOCK_PRESET_ID = 'free-swarm';

/**
 * The Flocking effect's presets: the starting swarms its card's Preset row offers first, in this
 * order (docs/Features/effects/flocking.md). The other entries of FLOCK_PRESETS (showcase scenes and
 * sculptures) follow under "More swarms"; tools and the Nodes tab accept every id. A flock preset
 * replaces the whole graph on `clip.flock`, so it is no EffectPreset of the effect definition.
 */
export const FLOCKING_CARD_PRESET_IDS: readonly string[] = ['free-swarm', 'krill-cloud', 'follow-path', 'technical-network', 'violet-filaments'];

export function getFlockPreset(presetId: string): FlockPresetDescriptor | undefined {
  return FLOCK_PRESETS.find((preset) => preset.id === presetId);
}

export function createFlockPresetDefinition(presetId: string = DEFAULT_FLOCK_PRESET_ID): FlockDefinition {
  return (getFlockPreset(presetId) ?? getFlockPreset(DEFAULT_FLOCK_PRESET_ID)!).create();
}
