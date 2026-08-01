import { afterEach, describe, expect, it } from 'vitest';

import { shouldDeferLayerNudgeToFocusedControl } from '../../src/components/preview/useLayerDrag';

afterEach(() => {
  document.body.replaceChildren();
});

describe('Preview layer-nudge keyboard ownership', () => {
  it.each([
    ['button', '<button type="button">Edit</button>'],
    ['motion-path handle', '<svg><circle role="button" tabindex="0"></circle></svg>'],
    ['slider', '<div role="slider" tabindex="0"></div>'],
    ['spinbutton', '<div role="spinbutton" tabindex="0"></div>'],
    ['text input', '<input />'],
    ['contenteditable', '<div contenteditable="true" tabindex="0"></div>'],
  ])('defers arrow keys to the focused %s', (_name, markup) => {
    document.body.innerHTML = markup;
    const control = document.body.querySelector<HTMLElement>('[tabindex],button,input');
    expect(control).not.toBeNull();
    control!.focus();

    expect(shouldDeferLayerNudgeToFocusedControl(document.activeElement)).toBe(true);
  });

  it('keeps viewport layer nudge active when the Preview container owns focus', () => {
    document.body.innerHTML = '<div class="preview-container" tabindex="0"></div>';
    const preview = document.querySelector<HTMLElement>('.preview-container')!;
    preview.focus();

    expect(shouldDeferLayerNudgeToFocusedControl(document.activeElement)).toBe(false);
  });
});
