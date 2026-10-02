import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import { canvasPlacement, prepareCanvasEdgeFill } from '../../src/effects/distort/ai-edge-fill/canvasPlacement';
import { edgeFillReference } from '../../src/effects/distort/ai-edge-fill/edgeFillReference';
import { vi } from 'vitest';
const layer = (): Layer => ({ id: 'photo', name: 'Photo', visible: true, opacity: 1, blendMode: 'normal',
  source: { type: 'image' }, position: { x: -.0359107, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
  scale: { x: .94488, y: .94488 }, rotation: { x: 0, y: 0, z: 0 }, effects: [
    { id: 'fill', type: 'ai-edge-fill', name: 'Fill', enabled: true, params: { artifactId: 'saved', canvasSpace: true } },
  ] });
describe('AI fill full composition placement', () => {
  it('includes the user’s scale and offset; all four composition edges can be filled without changing authored placement', () => {
    const original = layer(), rendered = prepareCanvasEdgeFill(original, original.effects, 3840, 5760, 3840, 5760, false)!;
    expect(original.scale.x).toBe(.94488); expect(original.position.x).toBeLessThan(0);
    expect(rendered.layer.scale).toEqual({ x: 1, y: 1 }); expect(rendered.layer.position).toEqual({ x: 0, y: 0, z: 0 });
    const m = canvasPlacement(original, 3840, 5760, 3840, 5760);
    const sample = (x: number, y: number) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
    expect(sample(0, .5)[0]).toBeLessThan(0); expect(sample(1, .5)[0]).toBeGreaterThan(1);
    expect(sample(.5, 0)[1]).toBeLessThan(0); expect(sample(.5, 1)[1]).toBeGreaterThan(1);
    expect(sample(.5 + original.position.x * .5, .5)).toEqual([.5, .5]);
  });
  it('matches native pixel placement independently of resolution and reverses 2D rotation exactly', () => {
    const photo = layer(); photo.scale = { x: .5, y: .5 }; photo.position.x = 0; photo.rotation.z = Math.PI / 2;
    const m = canvasPlacement(photo, 4000, 2000, 1000, 1000);
    // Source [u=.6,v=.7] lies at centered physical pixel [200,200] before rotation.
    // The compositor uses the inverse rotation: it maps output [x=.7,y=.3] back there.
    expect(m[0] * .7 + m[1] * .3 + m[2]).toBeCloseTo(.6);
    expect(m[3] * .7 + m[4] * .3 + m[5]).toBeCloseTo(.7);
  });
  it('keeps normal compositing when bypassed or before generating and rejects tilted planes', () => {
    const photo = layer(); expect(prepareCanvasEdgeFill(photo, photo.effects, 1, 1, 1, 1, true)).toBeNull();
    photo.effects[0].enabled = false; expect(prepareCanvasEdgeFill(photo, photo.effects, 1, 1, 1, 1, false)).toBeNull();
    photo.rotation.x = .1; expect(() => canvasPlacement(photo, 1, 1, 1, 1)).toThrow('2D placement');
  });
  it('marks every transparent pixel magenta and sends a separate complete binary mask', async () => {
    const photo = layer(), uploads: Uint8ClampedArray[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4, height: 4, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ setTransform: vi.fn(), resetTransform: vi.fn(), drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([50, 80, 90, 255, 0, 0, 0, 0, 9, 8, 7, 128]) }),
      createImageData: () => ({ data: new Uint8ClampedArray(12) }), putImageData: (value: ImageData) => uploads.push(value.data),
    }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['pixels'], { type: 'image/png' })));
    const result = await edgeFillReference(new Blob(), canvasPlacement(photo, 4, 4, 4, 4), 1);
    expect(result).toHaveLength(2);
    expect([...uploads[0]]).toEqual([50, 80, 90, 255, 255, 0, 255, 255, 255, 0, 255, 255]);
    expect([...uploads[1]]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  });
});
