import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialSetupOverlay } from '../../src/components/common/tutorial/TutorialSetupOverlay';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('TutorialSetupOverlay', () => {
  const setUserBackground = vi.fn();
  const setActiveShortcutPreset = vi.fn();
  const setTheme = vi.fn();

  beforeEach(() => {
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) => (
      selector({ setActiveShortcutPreset, setTheme, setUserBackground })
    )) as typeof useSettingsStore);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches the shortcut preset and continues into the walkthrough', () => {
    const onComplete = vi.fn();
    const { container } = render(<TutorialSetupOverlay onCancel={vi.fn()} onComplete={onComplete} />);

    expect(screen.getByText('Where are you coming from?')).toBeTruthy();
    expect(container.querySelector('.tutorial-setup-choice img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'DaVinci Resolve' }));

    expect(setUserBackground).toHaveBeenCalledWith('davinci');
    expect(setActiveShortcutPreset).toHaveBeenCalledWith('davinci');
    expect(setTheme).not.toHaveBeenCalled();
    expect(screen.getByText('Shortcuts switched')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('survives browser translation replacing its text nodes when going back', () => {
    // Google Translate swaps every text node for <font><font>…</font></font>.
    // Production crash 81fc519b29ff390c: "removeChild ... not a child of this node".
    const simulateTranslation = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      textNodes.forEach((textNode) => {
        const outer = document.createElement('font');
        const inner = document.createElement('font');
        inner.textContent = textNode.data;
        outer.appendChild(inner);
        textNode.replaceWith(outer);
      });
    };
    const { container } = render(<TutorialSetupOverlay onCancel={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'DaVinci Resolve' }));
    simulateTranslation(container);

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Back' }))).not.toThrow();
    expect(container.querySelectorAll('.tutorial-setup-choice')).toHaveLength(5);
    expect(screen.getByText('Where are you coming from?')).toBeTruthy();
  });

  it('can be ended from every setup state', () => {
    const onCancel = vi.fn();
    render(<TutorialSetupOverlay onCancel={onCancel} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'End walkthrough' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
