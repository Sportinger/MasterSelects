import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import common from '../../src/effects/_shared/commonShader';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { COLOR_RECIPE_EFFECT_TYPES, createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { createLegacyColorEffectGraph } from '../../src/services/operators/legacyColorEffectGraphs';

/**
 * The color recipes reach the GPU as one fragment module: the shared common WGSL plus the graph's
 * emitted program with its hand-written helpers (sRGB transfer, OkLCh). This assembles exactly that
 * module for every recipe and every original graph; with the naga validator installed (cargo
 * install naga-cli) it is also parsed and validated, otherwise the structural checks still run.
 * GPU-against-CPU pixel parity: tests/browser/image-graph-probe.html?suite=color-recipes.
 */
const NAGA = [process.env.NAGA, join(homedir(), '.cargo/bin/naga'), '/usr/local/bin/naga', '/usr/bin/naga'].find(path => path && existsSync(path));

function fragmentModule(type: EditableColorEffectType, graph = createDefaultColorEffectGraph(type)): string {
  const definition = imageGraphDefinition({ type, params: getDefaultParams(type), operatorGraph: graph }, getEffect(type) as FullscreenEffectDefinition);
  return `${common}\n${definition.shader}`;
}
const definedFunctions = (code: string) => [...code.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]);

describe('color recipe WGSL modules', () => {
  const types = [...COLOR_RECIPE_EFFECT_TYPES] as EditableColorEffectType[];
  const modules = types.flatMap(type => [[`${type} recipe`, fragmentModule(type)], [`${type} original`, fragmentModule(type, createLegacyColorEffectGraph(type))]] as const);

  it.each(modules)('%s defines every helper once and only the colour-space helpers it uses', (name, code) => {
    const functions = definedFunctions(code);
    expect(new Set(functions).size, name).toBe(functions.length);
    expect(functions, name).toContain('evaluateImageGraph');
    // OkLCh helpers are emitted on demand; the sRGB transfer is inline (Exposure, White Balance and the OkLCh helpers).
    expect(code.includes('fn imageGraphRgbToOklch'), name).toBe(name === 'hue-shift recipe');
    expect(code.includes('vec3f(0.04045)'), name).toBe(['exposure recipe', 'temperature recipe', 'hue-shift recipe'].includes(name));
  });

  it.skipIf(!NAGA).each(modules)('%s passes the naga WGSL validator', (name, code) => {
    const directory = mkdtempSync(join(tmpdir(), 'color-wgsl-'));
    try {
      const file = join(directory, `${name.replace(/\W+/g, '-')}.wgsl`);
      writeFileSync(file, code);
      expect(() => execFileSync(NAGA!, [file], { stdio: 'pipe' }), name).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
