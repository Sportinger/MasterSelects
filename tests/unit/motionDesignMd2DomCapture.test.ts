import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rasterizeMd2SvgElement } from '../../src/services/motionDesign/evidence/md2DomCapture';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

interface ImagePlan {
  fail: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

describe('MD2 DOM SVG capture', () => {
  let imagePlan: ImagePlan;
  let serializedSvg: string;
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    imagePlan = { fail: false, naturalWidth: 640, naturalHeight: 360 };
    serializedSvg = '';
    drawImage = vi.fn();

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = imagePlan.naturalWidth;
      naturalHeight = imagePlan.naturalHeight;

      set src(_value: string) {
        queueMicrotask(() => {
          if (imagePlan.fail) this.onerror?.();
          else this.onload?.();
        });
      }
    }

    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:md2-svg-capture'),
      revokeObjectURL: vi.fn(),
    });
    const serializeToString = XMLSerializer.prototype.serializeToString;
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(function serialize(node) {
      serializedSvg = serializeToString.call(this, node);
      return serializedSvg;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      drawImage,
    }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,bWQy');
  });

  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clones the real SVG, freezes recursive computed styles, and emits a PNG', async () => {
    const style = document.createElement('style');
    style.textContent = [
      '.md2-capture-root { color: rgb(12, 34, 56); }',
      '.md2-capture-child { fill: rgb(20, 180, 240); stroke: rgb(250, 250, 250); }',
    ].join('\n');
    document.head.append(style);

    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.classList.add('md2-capture-root');
    svg.setAttribute('width', '640');
    svg.setAttribute('height', '360');
    svg.setAttribute('viewBox', '10 20 640 360');
    svg.style.position = 'absolute';
    svg.style.left = '50%';
    svg.style.top = '50%';
    svg.style.transform = 'translate(-50%, -50%)';
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    });
    const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
    rect.classList.add('md2-capture-child');
    rect.setAttribute('width', '120');
    rect.setAttribute('height', '60');
    svg.append(rect);
    document.body.append(svg);

    await expect(rasterizeMd2SvgElement(svg))
      .resolves.toBe('data:image/png;base64,bWQy');

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:md2-svg-capture');
    expect(drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 640, 360);
    expect(serializedSvg).toContain('width="640"');
    expect(serializedSvg).toContain('height="360"');
    expect(serializedSvg).toContain('viewBox="10 20 640 360"');
    expect(serializedSvg).toContain('color: rgb(12, 34, 56)');
    expect(serializedSvg).toContain('fill: rgb(20, 180, 240)');
    expect(serializedSvg).toContain('stroke: rgb(250, 250, 250)');
    expect(serializedSvg).toContain('position: static');
    expect(serializedSvg).toContain('left: 0px');
    expect(serializedSvg).toContain('top: 0px');
    expect(serializedSvg).toContain('transform: none');
    expect(svg.style.position).toBe('absolute');
    expect(svg.style.left).toBe('50%');
    expect(svg.style.top).toBe('50%');
    expect(svg.style.transform).toBe('translate(-50%, -50%)');
    expect(rect.hasAttribute('style')).toBe(false);
  });

  it('derives missing viewport attributes from the viewBox', async () => {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 320 180');
    document.body.append(svg);

    await rasterizeMd2SvgElement(svg);

    expect(serializedSvg).toContain('width="320"');
    expect(serializedSvg).toContain('height="180"');
    expect(serializedSvg).toContain('viewBox="0 0 320 180"');
  });

  it('keeps explicit Motion Path paint without parent-dependent computed styles', async () => {
    const style = document.createElement('style');
    style.textContent = '.live-motion-node { fill: rgb(255, 0, 0); }';
    document.head.append(style);
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('data-motion-path-overlay', 'true');
    svg.setAttribute('width', '320');
    svg.setAttribute('height', '180');
    svg.setAttribute('viewBox', '0 0 320 180');
    svg.style.position = 'absolute';
    svg.style.transform = 'translate(-50%, -50%)';
    const node = document.createElementNS(SVG_NAMESPACE, 'circle');
    node.classList.add('live-motion-node');
    node.setAttribute('cx', '160');
    node.setAttribute('cy', '90');
    node.setAttribute('r', '6');
    node.setAttribute('fill', '#2997e5');
    svg.append(node);
    document.body.append(svg);

    await rasterizeMd2SvgElement(svg);

    expect(serializedSvg).toContain('data-md2-capture-background="motion-path"');
    expect(serializedSvg).toContain('fill="#11151b"');
    expect(serializedSvg).toContain('fill="#2997e5"');
    expect(serializedSvg).not.toContain('fill: rgb(255, 0, 0)');
    expect(serializedSvg).toContain('transform: none');
  });

  it('rejects zero dimensions before allocating an object URL', async () => {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');

    await expect(rasterizeMd2SvgElement(svg))
      .rejects.toThrow('zero or invalid dimensions');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects invalid image decoding and always revokes the object URL', async () => {
    imagePlan.fail = true;
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('width', '640');
    svg.setAttribute('height', '360');

    await expect(rasterizeMd2SvgElement(svg))
      .rejects.toThrow('Failed to decode rasterized SVG image');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:md2-svg-capture');
  });

  it('rejects a decoded image with zero dimensions and revokes its object URL', async () => {
    imagePlan.naturalWidth = 0;
    imagePlan.naturalHeight = 0;
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 640 360');

    await expect(rasterizeMd2SvgElement(svg))
      .rejects.toThrow('Rasterized SVG image has zero or invalid dimensions');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:md2-svg-capture');
  });
});
