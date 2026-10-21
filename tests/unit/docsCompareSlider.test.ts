// Docs compare sliders: the sync turns <figure class="docs-shot docs-compare"> around a pair asset
// (original | effect, no gap) into a slider stage (docs-site/scripts/lib/compare.mjs) and validates
// the pair; docs-site/src/scripts/docsCompare.js makes its divider draggable and keyboard-operable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPage, preparePage } from '../../docs-site/scripts/lib/convertPage.mjs';
import { compareSizeIssues, compareStageHtml } from '../../docs-site/scripts/lib/compare.mjs';
import { pageSlug } from '../../docs-site/scripts/lib/routes.mjs';

/** A WebP header (VP8X) of the given size. */
function webp(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  bytes.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  const w = width - 1, h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16], 24);
  return bytes;
}

/** The smallest MP4 the sync can read: moov with mvhd (5 s) and one trak whose tkhd says width × height. */
function mp4(width: number, height: number) {
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(body, 8);
    return out;
  };
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, 1000);
  new DataView(mvhd.buffer).setUint32(16, 5000);
  const tkhd = new Uint8Array(84);
  new DataView(tkhd.buffer).setUint32(76, width * 65536);
  new DataView(tkhd.buffer).setUint32(80, height * 65536);
  const trak = box('trak', box('tkhd', tkhd));
  const mvhdBox = box('mvhd', mvhd);
  const inner = new Uint8Array(mvhdBox.length + trak.length);
  inner.set(mvhdBox, 0);
  inner.set(trak, mvhdBox.length);
  return box('moov', inner);
}

const assets = new Map<string, Uint8Array>([
  ['assets/effects/gaussian-blur.webp', webp(1600, 450)],
  ['assets/effects/odd.webp', webp(1601, 450)],
  ['assets/effects/split.webp', webp(3200, 450)],
  ['assets/effects/clips/glitch.mp4', mp4(960, 492)],
  ['assets/effects/clips/glitch.webp', webp(960, 492)],
  ['assets/effects/clips/crt.mp4', mp4(1206, 338)],
  ['assets/effects/clips/crt.webp', webp(960, 492)],
]);

function convert(file: string, markdown: string) {
  const warnings: string[] = [];
  const checked: string[] = [];
  const prepared = preparePage(markdown, {});
  const text = convertPage(prepared, {
    file,
    published: (page: string) => pageSlug(page),
    exists: () => true,
    unpublished: () => false,
    anchorsOf: () => undefined,
    asset: (name: string) => assets.get(name),
    checkAsset: (name: string) => checked.push(name),
    warn: (message: string) => warnings.push(message),
  });
  return { text, warnings, checked };
}

const stillFigure = (extra = '', image = '../assets/effects/gaussian-blur.webp') => [
  `<figure class="docs-shot docs-compare"${extra}>`,
  '',
  `![The harbour, original left and blurred right](${image})`,
  '',
  '<figcaption>Left: original. Right: Radius 12.</figcaption>',
  '</figure>',
].join('\n');

describe('docs compare figures in the sync', () => {
  it('turns a still pair into a stage of one half\'s size with both halves, tags and a divider', () => {
    const { text, warnings, checked } = convert('effects/gaussian-blur.md', `# Gaussian Blur\n\nText.\n\n${stillFigure()}\n\nMore.\n`);
    expect(warnings).toEqual([]);
    expect(checked).toContain('assets/effects/gaussian-blur.webp');
    expect(text).toContain([
      '<figure class="docs-shot docs-compare">',
      '<div class="docs-compare-stage not-content" style="aspect-ratio: 800 / 450" data-before="Original" data-after="Gaussian Blur">',
      '<div class="docs-compare-after"><img src="/docs/assets/effects/gaussian-blur.webp" alt="The harbour, original left and blurred right" width="1600" height="450" decoding="async" draggable="false"><span class="docs-compare-tag" aria-hidden="true">Gaussian Blur</span></div>',
      '<div class="docs-compare-before"><img src="/docs/assets/effects/gaussian-blur.webp" alt="" width="1600" height="450" decoding="async" draggable="false"><span class="docs-compare-tag" aria-hidden="true">Original</span></div>',
      '<span class="docs-compare-handle"></span>',
      '</div>',
      '<figcaption>Left: original. Right: Radius 12.</figcaption>',
      '</figure>',
    ].join('\n'));
    // One HTML block: no blank line inside the figure, and no full-size link around the picture.
    expect(text).not.toContain('docs-shot-zoom');
  });

  it('takes the tags from data-before and data-after and loads a later picture lazily', () => {
    const markdown = `# Color\n\n![First](../assets/effects/clips/glitch.webp)\n\n${stillFigure(' data-before="Box Blur" data-after="Gaussian Blur"')}\n`;
    const { text } = convert('effects/blur-compare.md', markdown);
    expect(text).toContain('data-before="Box Blur" data-after="Gaussian Blur"');
    expect(text).toContain('<figure class="docs-shot docs-compare">');
    expect(text).toContain('alt="" width="1600" height="450" loading="lazy" decoding="async"');
    // The page's first picture, above the figure, stays eager.
    expect(text).toContain('alt="First" width="960" height="492" decoding="async"');
  });

  it('loads a compare at the top of the page eagerly and the pictures below it lazily', () => {
    const { text } = convert('effects/gaussian-blur.md', `# Gaussian Blur

${stillFigure()}

![Later](../assets/effects/clips/glitch.webp)
`);
    expect(text).toContain('alt="" width="1600" height="450" decoding="async"');
    expect(text).toContain('alt="Later" width="960" height="492" loading="lazy" decoding="async"');
  });

  it('builds a loop stage: one muted video under both halves, its poster in the halves, no controls', () => {
    const markdown = [
      '# Glitch',
      '',
      '<figure class="docs-shot docs-clip docs-compare docs-shot--float-left">',
      '<video src="../assets/effects/clips/glitch.mp4" poster="../assets/effects/clips/glitch.webp" width="960" height="492" autoplay muted loop playsinline preload="none" aria-label="The dancer, original left and glitching right"></video>',
      '<figcaption>Left: original. Right: Intensity 0.75.</figcaption>',
      '</figure>',
    ].join('\n');
    const { text, warnings } = convert('effects/glitch.md', markdown);
    expect(warnings).toEqual([]);
    expect(text).toContain('<figure class="docs-shot docs-clip docs-compare docs-shot--float-left">\n<div class="docs-compare-stage not-content" style="aspect-ratio: 480 / 492" data-before="Original" data-after="Glitch">');
    expect(text).toContain('<video class="docs-clip-video docs-compare-video" width="960" height="492" muted loop playsinline preload="none" data-docs-autoplay aria-label="The dancer, original left and glitching right"><source src="/docs/assets/effects/clips/glitch.mp4" type="video/mp4"></video>');
    expect(text).toContain('<div class="docs-compare-after"><img src="/docs/assets/effects/clips/glitch.webp" alt=""');
    expect(text).not.toMatch(/<video[^>]*\scontrols/u);
    expect(text).not.toMatch(/<video[^>]*\sposter=/u);
  });

  it('finds the poster of a Markdown clip shortcut next to the clip', () => {
    const { text, warnings, checked } = convert('effects/glitch.md', '# Glitch\n\n<figure class="docs-shot docs-compare">\n\n![The dancer glitching](../assets/effects/clips/glitch.mp4)\n\n</figure>\n');
    expect(warnings).toEqual([]);
    expect(checked).toContain('assets/effects/clips/glitch.webp');
    expect(text).toContain('aria-label="The dancer glitching"');
    expect(text).toContain('<img src="/docs/assets/effects/clips/glitch.webp"');
  });

  it('reports pairs that cannot be two equal halves, and a poster that does not match its clip', () => {
    expect(compareSizeIssues({ width: 1600, height: 450 })).toEqual([]);
    expect(compareSizeIssues({ width: 960, height: 492 })).toEqual([]);
    expect(compareSizeIssues({ width: 1601, height: 450 })[0]).toContain('odd width');
    expect(compareSizeIssues({ width: 3200, height: 450 })[0]).toContain('halves of 1600 × 450 px (3.56:1)');
    expect(compareSizeIssues({ width: 400, height: 900 })[0]).toContain('(0.22:1)');
    expect(compareSizeIssues(undefined)[0]).toContain('no readable size');

    expect(convert('effects/x.md', `# X\n\n${stillFigure('', '../assets/effects/odd.webp')}\n`).warnings)
      .toEqual([expect.stringContaining('effects/x.md: the compare figure assets/effects/odd.webp is 1601 px wide, an odd width')]);
    expect(convert('effects/x.md', `# X\n\n${stillFigure('', '../assets/effects/split.webp')}\n`).warnings)
      .toEqual([expect.stringContaining('would show halves of 1600 × 450 px')]);
    const mismatch = convert('effects/crt.md', '# CRT\n\n<figure class="docs-shot docs-compare">\n<video src="../assets/effects/clips/crt.mp4" poster="../assets/effects/clips/crt.webp" aria-label="CRT"></video>\n</figure>\n');
    expect(mismatch.warnings).toEqual([expect.stringContaining('is 1206 × 338 px, its poster 960 × 492: the halves would not line up')]);
  });

  it('leaves a figure without a pair asset as written, and compare markup in code alone', () => {
    const empty = convert('effects/x.md', '# X\n\n<figure class="docs-shot docs-compare">\n<figcaption>Nothing.</figcaption>\n</figure>\n');
    expect(empty.warnings).toEqual([expect.stringContaining('holds no picture or <video>')]);
    expect(empty.text).toContain('<figure class="docs-shot docs-compare">\n<figcaption>Nothing.</figcaption>\n</figure>');
    const code = convert('Documentation-Site.md', `# Docs\n\n\`\`\`markdown\n${stillFigure()}\n\`\`\`\n`);
    expect(code.text).toContain(`\`\`\`markdown\n${stillFigure()}\n\`\`\``);
    expect(code.warnings).toEqual([]);
  });
});

describe('docs compare slider script', () => {
  let stage: HTMLElement;
  let handle: HTMLElement;
  const pointer = (type: string, clientX: number, clientY: number, pointerType = 'mouse') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
    Object.assign(event, { pointerId: 1, isPrimary: true, pointerType });
    stage.dispatchEvent(event);
  };
  const key = (name: string, shiftKey = false) => handle.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
  const value = () => handle.getAttribute('aria-valuenow');

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = `<figure class="docs-shot docs-compare">${compareStageHtml({
      media: { kind: 'image', url: '/docs/assets/effects/gaussian-blur.webp', alt: 'Harbour', size: { width: 1600, height: 450 } },
      before: 'Original', after: 'Gaussian Blur', lazy: false,
    })}</figure>`;
    stage = document.querySelector('.docs-compare-stage') as HTMLElement;
    handle = document.querySelector('.docs-compare-handle') as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 225, right: 500, bottom: 225, x: 100, y: 0, toJSON: () => ({}) });
    Object.assign(stage, { setPointerCapture: vi.fn() });
    await import('../../docs-site/src/scripts/docsCompare.js');
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('makes the divider a labelled slider at 50 % and moves it with the keyboard', () => {
    expect(stage.hasAttribute('data-ready')).toBe(true);
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-label')).toBe('Compare original and Gaussian Blur');
    expect(value()).toBe('50');
    expect(handle.getAttribute('aria-valuetext')).toBe('Original 50 %, Gaussian Blur 50 %');
    key('ArrowRight');
    expect(value()).toBe('55');
    key('ArrowLeft', true);
    expect(value()).toBe('54');
    key('PageDown');
    expect(value()).toBe('34');
    key('End');
    expect(value()).toBe('100');
    key('ArrowRight');
    expect(value()).toBe('100');
    key('Home');
    expect(value()).toBe('0');
    expect(stage.style.getPropertyValue('--docs-compare')).toBe('0%');
  });

  it('jumps to a mouse press and follows the drag', () => {
    pointer('pointerdown', 200, 100);
    expect(value()).toBe('25');
    expect(stage.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', 400, 120);
    expect(value()).toBe('75');
    pointer('pointerup', 400, 120);
    pointer('pointermove', 150, 120);
    expect(value()).toBe('75');
  });

  it('lets a vertical touch scroll the page and moves the line on a tap or a sideways drag', () => {
    pointer('pointerdown', 300, 100, 'touch');
    pointer('pointermove', 302, 140, 'touch');
    pointer('pointercancel', 302, 140, 'touch');
    expect(value()).toBe('50');
    pointer('pointerdown', 140, 100, 'touch');
    pointer('pointerup', 142, 101, 'touch');
    expect(value()).toBe('11');
    pointer('pointerdown', 300, 100, 'touch');
    pointer('pointermove', 340, 104, 'touch');
    expect(value()).toBe('60');
    pointer('pointermove', 460, 110, 'touch');
    pointer('pointerup', 460, 110, 'touch');
    expect(value()).toBe('90');
  });
});
