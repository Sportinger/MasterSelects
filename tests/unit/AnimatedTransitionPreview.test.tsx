import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnimatedTransitionPreview } from '../../src/components/panels/transitions/AnimatedTransitionPreview';
import { TRANSITION_PREVIEW_RENDERERS } from '../../src/components/panels/transitions/previewRenderers';
import { getAllTransitions } from '../../src/transitions';

describe('AnimatedTransitionPreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('provides a dedicated animated SVG for every active transition', () => {
    const transitions = getAllTransitions();
    expect(transitions).toHaveLength(74);

    const { container } = render(
      <>
        {transitions.map((transition) => (
          <div className="transition-item" data-transition-id={transition.id} key={transition.id}>
            <AnimatedTransitionPreview type={transition.id} />
          </div>
        ))}
      </>,
    );

    expect(container.querySelectorAll('.transition-preview-animated')).toHaveLength(transitions.length);
    expect(container.querySelector('.transition-preview-fallback')).toBeNull();

    for (const transition of transitions) {
      const matches = TRANSITION_PREVIEW_RENDERERS.filter((renderPreview) => (
        renderPreview({ type: transition.id, idPrefix: 'coverage' }) !== null
      ));
      const item = container.querySelector(`[data-transition-id="${transition.id}"]`);

      expect(matches, `${transition.id} must belong to exactly one preview renderer`).toHaveLength(1);
      expect(item?.querySelector(`.transition-preview-${transition.id}`)).not.toBeNull();
    }
  });

  it('keeps SVG definition ids unique when several previews are mounted together', () => {
    const transitions = getAllTransitions();
    const { container } = render(
      <>
        {transitions.map((transition) => (
          <AnimatedTransitionPreview type={transition.id} key={transition.id} />
        ))}
      </>,
    );

    const ids = Array.from(container.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter(Boolean);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the generic fallback only for unknown transition ids', () => {
    const { container } = render(<AnimatedTransitionPreview type="unknown-transition" />);
    expect(container.querySelector('.transition-preview-fallback')).not.toBeNull();
  });

  it('resets idle animations and honors reduced-motion preferences', () => {
    const panelCss = readFileSync(
      resolve(process.cwd(), 'src/components/panels/TransitionsPanel.css'),
      'utf8',
    );

    expect(panelCss).toContain('.transition-item:not(:hover) .transition-preview-animated');
    expect(panelCss).toContain('animation: none;');
    expect(panelCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(panelCss).toContain('animation: none !important;');
  });
});
