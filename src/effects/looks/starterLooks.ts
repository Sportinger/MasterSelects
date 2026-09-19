import type { LookDefinition } from './types';

const look = (
  id: string,
  name: string,
  category: LookDefinition['category'],
  tags: string[],
  stack: LookDefinition['stack'],
): LookDefinition => ({
  id,
  name,
  category,
  tags,
  stack,
  builtIn: true,
  thumbnail: { kind: 'generated' },
});

const fx = (
  effectId: string,
  params: Record<string, number | boolean | string> = {},
): LookDefinition['stack'][number] => ({ effectId, params, enabled: true });

export const STARTER_LOOKS: LookDefinition[] = [
  look('digital-noir', 'Digital Noir', 'editorial', ['monochrome', 'graphic', 'dither'], [
    fx('dither-studio', { kernel: 'bayer-4', scale: 5, amount: 0.82, colorA: '#080b12', colorB: '#e7edf4' }),
    fx('vignette', { amount: 0.48 }),
  ]),
  look('riso-pulse', 'Riso Pulse', 'print', ['riso', 'ink', 'animated'], [
    fx('riso-glow', { amount: 0.8, scale: 7, speed: 0.65, colorA: '#2447aa', colorB: '#f23d68' }),
    fx('grain', { amount: 0.13 }),
  ]),
  look('crt-memory', 'CRT Memory', 'analog', ['crt', 'retro', 'scanline'], [
    fx('crt-screen', { amount: 0.72, scale: 3, speed: 0.25 }),
    fx('rgb-split', { amount: 0.012 }),
  ]),
  look('paper-press', 'Paper Press', 'print', ['paper', 'press', 'soft'], [
    fx('paper-print', { amount: 0.78, scale: 24, colorA: '#1a202c', colorB: '#efe8d5' }),
    fx('grain', { amount: 0.08 }),
  ]),
  look('holo-drift', 'Holo Drift', 'digital', ['hologram', 'spectrum', 'animated'], [
    fx('holo', { amount: 0.72, scale: 16, speed: 0.8, colorA: '#13d8e8', colorB: '#ef65bc' }),
    fx('glow', { amount: 0.2 }),
  ]),
  look('crystal-signal', 'Crystal Signal', 'digital', ['glass', 'refraction', 'clean'], [
    fx('crystal', { amount: 0.62, scale: 18, speed: 0.2 }),
    fx('sharpen', { amount: 0.22 }),
  ]),
  look('pixel-editorial', 'Pixel Editorial', 'editorial', ['pixel', 'poster', 'bold'], [
    fx('pixel-poster', { amount: 0.82, scale: 11 }),
    fx('vignette', { amount: 0.25 }),
  ]),
  look('stitch-portrait', 'Stitch Portrait', 'print', ['textile', 'stitch', 'craft'], [
    fx('cross-stitch', { amount: 0.9, scale: 10, colorA: '#18253a', colorB: '#f0e9da' }),
  ]),
  look('data-glitch', 'Data Glitch', 'digital', ['glitch', 'grid', 'motion'], [
    fx('glitch-grid', { amount: 0.55, scale: 20, speed: 1.25 }),
    fx('glitch', { amount: 0.32, scale: 28, speed: 0.8 }),
  ]),
  look('mosaic-motion', 'Mosaic Motion', 'motion', ['mosaic', 'kinetic', 'block'], [
    fx('scatter-mosaic', { amount: 0.62, scale: 16, speed: 0.65 }),
    fx('posterize', { levels: 7 }),
  ]),
  look('prism-film', 'Prism Film', 'analog', ['film', 'prism', 'grain'], [
    fx('film-prism', { amount: 0.68, speed: 0.3 }),
    fx('grain', { amount: 0.12 }),
  ]),
  look('wave-blueprint', 'Wave Blueprint', 'editorial', ['line', 'blueprint', 'graphic'], [
    fx('wave-lines', { amount: 0.82, scale: 18, speed: 0.25, colorA: '#d8efff', colorB: '#102a43' }),
    fx('edge-detect', { strength: 0.15 }),
  ]),
  look('block-broadcast', 'Block Broadcast', 'digital', ['broadcast', 'block', 'scanline'], [
    fx('block-mosaic', { amount: 0.72, scale: 18, speed: 0.25 }),
    fx('scanlines', { opacity: 0.16, density: 4 }),
  ]),
  look('drift-ink', 'Drift Ink', 'motion', ['line', 'ink', 'animated'], [
    fx('drift-lines', { amount: 0.76, scale: 10, speed: 0.45, colorA: '#101820', colorB: '#f2efe7' }),
    fx('contrast', { amount: 1.08 }),
  ]),
];
