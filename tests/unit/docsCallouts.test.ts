// Live callouts (docs-site/src/scripts/docsCallouts.js): a bold word in the text lights the callout
// of its picture. A picture under an h3 links only the words of its own h3 subsection, so two stage
// pictures that both point at a "Multiply" card each answer to their own paragraph; a picture right
// under an h2 still links the words of all its subsections.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const overlay = (labels: string[]) => `<svg class="docs-shot-overlay" viewBox="0 0 100 100">${labels.map((_, index) =>
  `<path class="docs-shot-arrow" d="M0 0 L1 1" /><circle class="docs-shot-number" cx="10" cy="10" r="5" /><text class="docs-shot-number-text">${index + 1}</text>`).join('')}</svg>`;
const figure = (id: string, labels: string[]) => `<figure id="${id}" class="docs-shot"><div class="docs-shot-stage"><p><img alt="" /></p>${overlay(labels)}</div>`
  + `<figcaption>${labels.map((label, index) => `${index + 1} — ${label}: what it does.`).join(' ')}</figcaption></figure>`;

describe('docs live callouts', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    document.body.innerHTML = `<div class="sl-markdown-content">
      <h2 id="controls">Controls</h2>${figure('card', ['Band Size'])}
      <h3>Pattern</h3><p id="band-size"><strong>Band Size</strong> – how thick.</p>
      <h2 id="node-setup">Node setup</h2>
      <h3>Bands</h3>${figure('bands', ['Multiply'])}<p id="bands-text"><strong>Multiply</strong> – the band height.</p>
      <h3>Line Shading</h3>${figure('lines', ['Multiply'])}<p id="lines-text"><strong>Multiply</strong> – darkens the colour.</p>
    </div>`;
    await import('../../docs-site/src/scripts/docsCallouts.js');
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  const hover = (selector: string) => {
    const event = new MouseEvent('pointerenter');
    Object.assign(event, { pointerType: 'mouse' });
    document.querySelector(selector)!.dispatchEvent(event);
  };
  const active = (id: string) => document.querySelector(`#${id} .docs-callout`)!.classList.contains('is-active');

  it('links a word under an h3 only to the picture of its own subsection', () => {
    hover('#bands-text strong');
    expect([active('bands'), active('lines')]).toEqual([true, false]);
    hover('#lines-text strong');
    expect([active('bands'), active('lines')]).toEqual([false, true]);
  });

  it('links a picture right under an h2 to the words of its subsections', () => {
    hover('#band-size strong');
    expect(active('card')).toBe(true);
    expect(document.querySelector('#band-size strong')!.classList.contains('docs-callout-word')).toBe(true);
  });
});
