// Every control an effect card shows (and the docs list) must change the picture: a shown parameter
// that the effect's recipe never reads is a silent no-op. Retire it instead (`retired` in
// createCatalogEffect / createTrackingEffect, with the reason tools return); retired values still load.
import { describe, expect, it } from 'vitest';
import { getAllEffects, getDefaultParams } from '../../src/effects';
import { graphBoundParameters } from '../../src/services/operators/effectParamVisibility';

/** Parameters read outside the default graph, by the effect's own runtime. */
const READ_BY_RUNTIME: Record<string, string> = {
  'slit-scan': 'the time, 3D-geometry, map, memory and stabilization runtimes read these controls',
  'time-stack': 'the frame-history runtime reads the preview size and memory budget',
};
/** Uniform fields of the shared catalog and tracking shaders → the parameter that fills them. */
const UNIFORM_PARAM: Record<string, string> = { scale: 'scale', amount: 'amount', angle: 'angle', speed: 'speed', colorA: 'colorA', colorB: 'colorB', color: 'color', trail: 'trail', tint: 'tint' };

/** Uniform fields an entry point reads, through the helper functions it calls. */
export function uniformFieldsRead(wgsl: string, entryPoint: string): Set<string> {
  const bodies = new Map<string, string>();
  for (const match of wgsl.matchAll(/\bfn\s+(\w+)\s*\(/gu)) {
    const open = wgsl.indexOf('{', match.index);
    let depth = 0, end = open;
    for (; end < wgsl.length; end += 1) {
      if (wgsl[end] === '{') depth += 1;
      else if (wgsl[end] === '}' && --depth === 0) break;
    }
    bodies.set(match[1], wgsl.slice(open, end + 1));
  }
  const fields = new Set<string>(), seen = new Set<string>(), queue = [entryPoint];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name) || !bodies.has(name)) continue;
    seen.add(name);
    const body = bodies.get(name)!;
    for (const read of body.matchAll(/\bparams\.(\w+)/gu)) fields.add(read[1]);
    for (const call of body.matchAll(/\b(\w+)\s*\(/gu)) if (bodies.has(call[1])) queue.push(call[1]);
  }
  return fields;
}

const shown = (params: Record<string, { hidden?: boolean; deprecated?: string }>) =>
  Object.entries(params).filter(([, param]) => !param.hidden && !param.deprecated).map(([key]) => key);

describe('effect cards show only controls that act', () => {
  it('every shown control of a graph effect is read by its default graph', () => {
    const unread: string[] = [];
    for (const effect of getAllEffects()) {
      if (READ_BY_RUNTIME[effect.id]) continue;
      const bound = graphBoundParameters({ type: effect.id, params: getDefaultParams(effect.id) });
      if (!bound) continue;
      for (const key of shown(effect.params)) if (!bound.has(key)) unread.push(`${effect.id}.${key}`);
    }
    expect(unread).toEqual([]);
  });

  it('every shown shared control of a shader effect is read by its entry point', () => {
    const unread: string[] = [], checked: string[] = [];
    for (const effect of getAllEffects()) {
      const shader = 'shader' in effect ? effect.shader : undefined;
      const entryPoint = 'entryPoint' in effect ? effect.entryPoint : undefined;
      if (typeof shader !== 'string' || typeof entryPoint !== 'string' || !/struct (Catalog|Tracking)Params\b/u.test(shader)) continue;
      if (graphBoundParameters({ type: effect.id, params: getDefaultParams(effect.id) })) continue;
      checked.push(effect.id);
      const fields = uniformFieldsRead(shader, entryPoint);
      for (const key of shown(effect.params)) {
        const field = Object.entries(UNIFORM_PARAM).find(([, param]) => param === key)?.[0];
        if (field && !fields.has(field)) unread.push(`${effect.id}.${key}`);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(['subject', 'tracked-scene', 'kinetic-trace', 'hud-tracker']));
    expect(unread).toEqual([]);
  });

  it('reads helper functions transitively', () => {
    const wgsl = 'fn rotated(uv: vec2f) -> vec2f { return uv * params.angle; }\nfn main() -> f32 { let p = rotated(vec2f(0.0)); return params.amount; }\nfn other() { params.speed; }';
    expect([...uniformFieldsRead(wgsl, 'main')].toSorted()).toEqual(['amount', 'angle']);
  });

  it('retired controls stay loadable and say why they are ignored', () => {
    const dither = getAllEffects().find(effect => effect.id === 'dither')!;
    expect(dither.params.colorA.deprecated).toMatch(/ignored/u);
    expect(getDefaultParams('dither')).not.toHaveProperty('colorA');
    const subject = getAllEffects().find(effect => effect.id === 'subject')!;
    expect(subject.params.color.deprecated).toMatch(/ignored/u);
  });
});
