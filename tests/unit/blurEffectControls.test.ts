// What blur parameters do on a given instance, said instead of done silently: retired and
// graph-only parameters follow the instance's graph, zero strength skips the passes, and limits
// at the frame size come back as notes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { blurBudgetNotes } from '../../src/effects/blur/blurSampling';
import { effectParamDefinitions, unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';
import { isNeutralBlurEffect } from '../../src/services/operators/blurIdentity';
import { createDefaultGaussianBlurGraph } from '../../src/services/operators/blurEffectGraphs';
import { createLegacyGaussianBlurGraph } from '../../src/services/operators/legacyBlurEffectGraphs';
import { createLegacyRadialBlurGraph } from '../../src/services/operators/legacyDirectionalBlurEffectGraphs';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { useTimelineStore } from '../../src/stores/timeline';
import { executeAITool } from '../../src/services/aiTools';
import { motionBlur } from '../../src/effects/blur/motion';
import { radialBlur } from '../../src/effects/blur/radial';
import { zoomBlur } from '../../src/effects/blur/zoom';
import { sharpen } from '../../src/effects/stylize/sharpen';
import { sharpenParamNotes } from '../../src/effects/stylize/sharpen/sharpenModel';
import { resolveEffectPreset } from '../../src/services/effects/effectPresets';
import { effectParamDisplay } from '../../src/effects/paramDisplay';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/** A saved legacy graph with one literal changed: user work, kept as saved. */
function editedLegacy(create: () => EffectOperatorGraph): EffectOperatorGraph {
  const graph = create();
  const literal = graph.nodes.find(node => node.operator === 'values.number' && node.constants && !Object.keys(node.bindings).length && node.id === 'half')
    ?? graph.nodes.find(node => node.operator === 'values.number' && node.constants && !Object.keys(node.bindings).length)!;
  literal.constants = { value: Number(literal.constants!.value) + 0.25 };
  return graph;
}

describe('blur parameters follow the instance graph', () => {
  it('hides the retired Samples on the current recipe and says it does nothing', () => {
    const effect = { type: 'gaussian-blur', params: { radius: 10, samples: 9 } };
    expect(effectParamDefinitions(effect).samples.hidden).toBe(true);
    expect(unusedParamWarnings(effect, ['radius', 'samples'])).toEqual([expect.stringMatching(/^samples: .*no effect/)]);
  });

  it('shows Samples again on an edited legacy graph that still reads it, without a warning', () => {
    const effect = { type: 'gaussian-blur', params: { radius: 10, samples: 9 }, operatorGraph: editedLegacy(createLegacyGaussianBlurGraph) };
    expect(effectParamDefinitions(effect).samples.hidden).toBe(false);
    expect(unusedParamWarnings(effect, ['samples'])).toEqual([]);
  });

  it('hides Radial Type on an edited legacy graph that does not read it, and warns when it is set', () => {
    const current = { type: 'radial-blur', params: { mode: 'spin' } };
    expect(effectParamDefinitions(current).mode.hidden).toBeFalsy();
    expect(unusedParamWarnings(current, ['mode'])).toEqual([]);
    const legacy = { type: 'radial-blur', params: { mode: 'spin' }, operatorGraph: editedLegacy(createLegacyRadialBlurGraph) };
    expect(effectParamDefinitions(legacy).mode.hidden).toBe(true);
    expect(effectParamDefinitions(legacy).samples.hidden).toBe(false);
    expect(unusedParamWarnings(legacy, ['mode'])).toEqual([expect.stringMatching(/^mode: .*does not read it/)]);
  });
});

describe('zero-strength blurs skip their passes', () => {
  it('treats a blur at zero as the identity only for the built-in recipe', () => {
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0 } }, 1920, 1080)).toBe(true);
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0.1 } }, 1920, 1080)).toBe(true);
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 1 } }, 1920, 1080)).toBe(false);
    expect(isNeutralBlurEffect({ type: 'box-blur', params: { radius: 0 } }, 3840, 2160)).toBe(true);
    expect(isNeutralBlurEffect({ type: 'box-blur', params: { radius: 0.01 } }, 1920, 1080)).toBe(false);
    for (const type of ['motion-blur', 'zoom-blur', 'radial-blur']) {
      expect(isNeutralBlurEffect({ type, params: { amount: 0 } }, 1920, 1080), type).toBe(true);
      expect(isNeutralBlurEffect({ type, params: { amount: 0.01 } }, 1920, 1080), type).toBe(false);
    }
    // A saved copy of the recipe (packed, moved) still counts; an edited graph may do more than blur.
    const saved = recognizeOperatorCompositions(createDefaultGaussianBlurGraph());
    saved.layout = Object.fromEntries(Object.keys(saved.layout).map(id => [id, { x: 3, y: 4 }]));
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0 }, operatorGraph: saved }, 1920, 1080)).toBe(true);
    const edited = createDefaultGaussianBlurGraph();
    edited.nodes.find(node => node.id === 'coverage-floor')!.constants = { value: 0.5 };
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0 }, operatorGraph: edited }, 1920, 1080)).toBe(false);
    // Older projects keep the graph as a string parameter: an untouched recipe there is skipped too.
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0, operatorGraph: JSON.stringify(createLegacyGaussianBlurGraph()) } }, 1920, 1080)).toBe(true);
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0, operatorGraph: JSON.stringify(edited) } }, 1920, 1080)).toBe(false);
    expect(isNeutralBlurEffect({ type: 'gaussian-blur', params: { radius: 0, operatorGraph: '{broken' } }, 1920, 1080)).toBe(false);
    expect(isNeutralBlurEffect({ type: 'sharpen', params: { radius: 0 } }, 1920, 1080)).toBe(false);
  });
});

describe('a skipped zero-strength blur still feeds its effect preview', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('captures the unchanged input as the effect output and renders no pass', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4, COPY_SRC: 8 });
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => undefined),
      createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })), createBindGroup: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createSampler: vi.fn(() => ({})), createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
      queue: { writeBuffer: vi.fn() } } as unknown as GPUDevice;
    const beginRenderPass = vi.fn(), encoder = { beginRenderPass } as unknown as GPUCommandEncoder;
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    const input = { label: 'input' } as unknown as GPUTextureView, view = () => ({}) as GPUTextureView;
    const result = new EffectsPipeline(device).applyEffects(encoder, [{ id: 'soft', type: 'gaussian-blur', name: 'Gaussian Blur', enabled: true,
      params: { radius: 0 } }], {} as GPUSampler, input, view(), view(), view(), 1920, 1080);
    expect(result).toEqual({ finalView: input, swapped: false });
    expect(beginRenderPass).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('effect:soft', device, encoder, expect.anything(), input, 1920, 1080);
  });
});

describe('Motion Blur card and presets', () => {
  it('shows Length in percent and Angle in degrees while storing shares and radians', () => {
    expect(effectParamDisplay(motionBlur.params.amount, 0.05)).toMatchObject({ scale: 100, suffix: '%' });
    expect(motionBlur.params.amount).toMatchObject({ default: 0.05, min: 0, max: 0.3 });
    expect(effectParamDisplay(motionBlur.params.angle).suffix).toBe('°');
  });

  it('declares presets whose angles land on whole degrees and whose lengths stay in range', () => {
    expect(motionBlur.presets?.map(preset => preset.name)).toEqual(['Quick Move', 'Leap', 'Falling', 'Whip Pan']);
    for (const preset of motionBlur.presets ?? []) {
      const { amount, angle } = preset.params as { amount: number; angle: number };
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(0.3);
      expect(Math.abs(angle * 180 / Math.PI - Math.round(angle * 180 / Math.PI))).toBeLessThan(1e-9);
    }
    expect(motionBlur.presets?.find(preset => preset.id === 'falling')?.params.angle).toBe(Math.PI / 2);
  });
});

describe('Radial Blur presets', () => {
  it('name a valid Type and an Amount in range, and keep the centre in the middle', () => {
    expect(radialBlur.presets?.map(preset => preset.name)).toEqual(['Dizzy', 'Turning Stage', 'Whirlpool', 'Tunnel Vision']);
    const modes = (radialBlur.params.mode.options ?? []).map(option => option.value);
    for (const preset of radialBlur.presets ?? []) {
      const { mode, amount } = preset.params as { mode: string; amount: number };
      expect(modes).toContain(mode);
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(2);
      expect(resolveEffectPreset({ type: 'radial-blur', params: {} }, preset)).toMatchObject({ mode, amount, centerX: 0.5, centerY: 0.5 });
    }
  });
});

describe('Zoom Blur presets', () => {
  it('grow in Amount within the card range and keep the centre in the middle', () => {
    expect(zoomBlur.presets?.map(preset => preset.name)).toEqual(['Push In', 'Impact', 'Rush', 'Light Speed']);
    const amounts = (zoomBlur.presets ?? []).map(preset => (preset.params as { amount: number }).amount);
    expect(amounts).toEqual(amounts.toSorted((a, b) => a - b));
    for (const preset of zoomBlur.presets ?? []) {
      const { amount } = preset.params as { amount: number };
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(zoomBlur.params.amount.max ?? 1);
      expect(blurBudgetNotes('zoom-blur', { amount }, 1920, 1080)).toEqual([]);
      expect(resolveEffectPreset({ type: 'zoom-blur', params: { centerX: 0.2 } }, preset)).toMatchObject({ amount, centerX: 0.5, centerY: 0.5 });
    }
  });
});

describe('Sharpen presets', () => {
  it('set Amount and Radius within the card range, from fine detail to large shapes, without limit notes', () => {
    expect(sharpen.presets?.map(preset => preset.name)).toEqual(['Fine Detail', 'Crisp', 'Gritty', 'Punch']);
    const radii = (sharpen.presets ?? []).map(preset => (preset.params as { radius: number }).radius);
    expect(radii).toEqual(radii.toSorted((a, b) => a - b));
    for (const preset of sharpen.presets ?? []) {
      const { amount, radius } = preset.params as { amount: number; radius: number };
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(sharpen.params.amount.max ?? 5);
      expect(radius).toBeGreaterThanOrEqual(sharpen.params.radius.min ?? 0.5);
      expect(radius).toBeLessThanOrEqual(sharpen.params.radius.max ?? 5);
      expect(sharpenParamNotes({ amount, radius }, 1920, 1080)).toEqual([]);
      expect(resolveEffectPreset({ type: 'sharpen', params: { amount: 3, radius: 2 } }, preset)).toMatchObject({ amount, radius });
    }
  });

  it('says when the halo window spreads its taps instead of thinning it silently', () => {
    expect(sharpenParamNotes({ amount: 1, radius: 5 }, 3840, 2160)).toEqual([]);
    const [note] = sharpenParamNotes({ amount: 1, radius: 5 }, 7680, 4320);
    expect(note).toContain('halo window reach 40 px at 7680x4320');
    expect(note).toContain('1.7 px apart');
  });
});

describe('blur limits are reported, not applied silently', () => {
  it('says when a separable kernel spreads its reads or a streak outgrows the tap budget', () => {
    expect(blurBudgetNotes('gaussian-blur', { radius: 50 }, 1920, 1080)).toEqual([]);
    expect(blurBudgetNotes('gaussian-blur', { radius: 50 }, 7680, 4320)).toEqual([expect.stringMatching(/Radius 50 reaches 300 px .*7680×4320.*spread/)]);
    expect(blurBudgetNotes('box-blur', { radius: 300 }, 1920, 1080)).toHaveLength(1);
    expect(blurBudgetNotes('motion-blur', { amount: 0.3 }, 7680, 4320)).toEqual([]);
    expect(blurBudgetNotes('motion-blur', { amount: 3 }, 7680, 4320)).toEqual([expect.stringMatching(/stepped/)]);
    expect(blurBudgetNotes('radial-blur', { amount: 20 }, 1920, 1080)).toEqual(expect.arrayContaining([expect.stringMatching(/centre/)]));
    expect(blurBudgetNotes('zoom-blur', { amount: -3 }, 1920, 1080)).toEqual(expect.arrayContaining([expect.stringMatching(/centre/)]));
    expect(blurBudgetNotes('brightness', { amount: 1 }, 1920, 1080)).toEqual([]);
  });
});

describe('effect tools report what a blur parameter does on this instance', () => {
  const initial = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(initial));

  it('offers only visible parameters as valid and returns limit notes', async () => {
    const clip = createMockClip({ id: 'c', trackId: 't', duration: 4, effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
    const added = await executeAITool('addEffect', { clipId: 'c', effectType: 'gaussian-blur', params: { radius: 400 } }, 'internal');
    expect((added.data as { warnings?: string[] }).warnings).toEqual([expect.stringMatching(/^Radius 400 reaches/)]);
    const effectId = (added.data as { effectId: string }).effectId;
    const wrong = await executeAITool('updateEffect', { clipId: 'c', effectId, params: { raduis: 3 } }, 'internal');
    expect(wrong.success).toBe(false);
    expect(wrong.error).toMatch(/Valid: radius$/);
  });
});
