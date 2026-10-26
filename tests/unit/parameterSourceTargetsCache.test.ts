import { describe, expect, it, vi } from 'vitest';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { getParameterSourceTarget, parameterSourceTargets, type ParameterSourceClip } from '../../src/services/parameterSources/parameterSourceTargets';
import type { Effect } from '../../src/types/effects';

// Inspector rows ask for targets in store selectors on every playhead tick; Analog Signal Lab compiled its
// whole operator graph for each row and tick (5 fps playback with its card open). One clip version is
// listed once.
// Counted, to show that a cached tick never compiles the graph again.
vi.mock('../../src/services/operators/effectGraphOwner', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/services/operators/effectGraphOwner')>();
  return { ...actual, effectOperatorGraph: vi.fn(actual.effectOperatorGraph) };
});

const blur = (radius: number): Effect => ({ id: 'blur', type: 'gaussian-blur', name: 'Gaussian Blur', enabled: true, params: { radius } });
const clip = (effects: Effect[]): ParameterSourceClip => ({ effects, colorCorrection: undefined, nodeGraph: undefined, startTime: 0 });

describe('parameter source targets cache', () => {
  it('lists one version of a clip once and shares the frozen list', () => {
    const source = clip([blur(4)]);
    const first = parameterSourceTargets(source);
    expect(parameterSourceTargets(source)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(getParameterSourceTarget(source, 'effect.blur.radius')?.value).toBe(4);
  });

  it('lists a clip again when its effects change', () => {
    const source = clip([blur(4)]);
    const first = parameterSourceTargets(source);
    const edited = { ...source, effects: [blur(9)] };
    expect(getParameterSourceTarget(edited, 'effect.blur.radius')?.value).toBe(9);
    source.effects = [blur(2)];
    expect(parameterSourceTargets(source)).not.toBe(first);
    expect(getParameterSourceTarget(source, 'effect.blur.radius')?.value).toBe(2);
  });

  it('compiles the operator graph of Analog Signal Lab once per effect version', () => {
    const lab: Effect = { id: 'lab', type: 'analog-signal-lab', name: 'Analog Signal Lab', enabled: true, params: {} };
    const source = clip([lab]);
    vi.mocked(effectOperatorGraph).mockClear();
    const first = parameterSourceTargets(source);
    for (let tick = 0; tick < 60; tick += 1) expect(parameterSourceTargets(source)).toBe(first);
    expect(effectOperatorGraph).toHaveBeenCalledTimes(1);
    parameterSourceTargets({ ...source, effects: [{ ...lab, params: { crtStage: 1 } }] });
    expect(effectOperatorGraph).toHaveBeenCalledTimes(2);
  });
});
