import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const { getGlyphAtlas } = vi.hoisted(() => ({ getGlyphAtlas: vi.fn() }));
vi.mock('../../src/effects/_shared/glyphAtlas', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/effects/_shared/glyphAtlas')>();
  return { ...actual, getGlyphAtlas };
});

import { resolveImageGraphExternalResources } from '../../src/effects/_shared/imageGraphExternalResources';

const device = { createTexture: vi.fn() } as unknown as GPUDevice;
const view = { label: 'borrowed atlas view' } as GPUTextureView;
const plan = (externalResources: NonNullable<ImageOperatorPlan['externalResources']>) => ({ externalResources });

describe('image graph external resources', () => {
  beforeEach(() => {
    getGlyphAtlas.mockReset();
    getGlyphAtlas.mockReturnValue({ view, texture: { destroy: vi.fn() } });
    vi.mocked((device as unknown as { createTexture: ReturnType<typeof vi.fn> }).createTexture).mockClear();
  });

  it('borrows and deduplicates canonically equivalent glyph atlases', () => {
    const options = { fontFamily: 'monospace', charset: ' .#', cellSize: 63.6 };
    const resources = resolveImageGraphExternalResources(device, plan([
      { id: 'glyph-atlas:ramp', kind: 'glyph-atlas', options },
      { id: 'glyph-atlas:ramp', kind: 'glyph-atlas', options: { ...options, cellSize: 64, fontWeight: 600 } },
    ]));

    expect(getGlyphAtlas).toHaveBeenCalledOnce();
    expect(resources.get('glyph-atlas:ramp')?.view).toBe(view);
    expect(resources.get('glyph-atlas:ramp')?.identity).toContain('monospace');
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it('changes identity with effective font or ramp content', () => {
    const resolveIdentity = (fontFamily: string, charset: string) => resolveImageGraphExternalResources(device, plan([
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily, charset, cellSize: 32 } },
    ])).get('atlas')?.identity;

    const base = resolveIdentity('monospace', ' .#');
    expect(resolveIdentity('serif', ' .#')).not.toBe(base);
    expect(resolveIdentity('monospace', ' .@')).not.toBe(base);
  });

  it('fails closed for conflicting duplicate ids and unsupported kinds', () => {
    expect(() => resolveImageGraphExternalResources(device, plan([
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset: '01', cellSize: 32 } },
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset: '10', cellSize: 32 } },
    ]))).toThrow(/conflicting descriptors/);
    expect(getGlyphAtlas).not.toHaveBeenCalled();
    expect(() => resolveImageGraphExternalResources(device, plan([
      { id: 'other', kind: 'future-resource', options: {} } as never,
    ]))).toThrow(/Unsupported image graph external resource kind/);
  });

  it('does not assume ownership of atlas textures', () => {
    const destroy = vi.fn();
    getGlyphAtlas.mockReturnValueOnce({ view, texture: { destroy } });
    const resources = resolveImageGraphExternalResources(device, plan([
      { id: 'atlas', kind: 'glyph-atlas', options: { fontFamily: 'mono', charset: 'x', cellSize: 32 } },
    ]));

    expect(resources.get('atlas')?.view).toBe(view);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('borrows typed memory windows with fresh availability and dimensions', () => {
    const descriptor = { id: 'memory-window:source', kind: 'memory-window' as const,
      options: { size: 320, depth: '8' as const, offset: 0, motion: 'advance' as const, stride: 64, seed: 1, snapshot: '' } };
    expect(() => resolveImageGraphExternalResources(device, plan([descriptor]))).toThrow(/explicit runtime resolver/);
    const resolveMemoryWindow = vi.fn(() => ({ view, identity: 'heap:2:window:17', width: 320, height: 180, available: true }));
    const result = resolveImageGraphExternalResources(device, plan([descriptor, descriptor]), { resolveMemoryWindow });
    expect(resolveMemoryWindow).toHaveBeenCalledOnce();
    expect(result.get(descriptor.id)).toMatchObject({ width: 320, height: 180, available: true, identity: 'heap:2:window:17' });
    expect(getGlyphAtlas).not.toHaveBeenCalled();
    const absent = resolveImageGraphExternalResources(device, plan([descriptor]), {
      resolveMemoryWindow: () => ({ view, identity: 'unavailable', width: 1, height: 1, available: false }),
    });
    expect(absent.get(descriptor.id)?.available).toBe(false);
    expect(() => resolveImageGraphExternalResources(device, plan([descriptor]), {
      resolveMemoryWindow: () => ({ view, identity: 'invalid', width: 0, height: 1, available: true }),
    })).toThrow(/invalid runtime metadata/);
  });
});
