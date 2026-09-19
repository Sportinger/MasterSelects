import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreationModeLandingPage } from '../../src/marketing/CreationModeLandingPage';
import { creationModeMaskRadius } from '../../src/marketing/creationModeGeometry';
import { resolveInitialDockLayoutId } from '../../src/routing/entryDockLayout';
import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from '../../src/stores/dockStore';
import { useAccountStore } from '../../src/stores/accountStore';
import { productAnalytics } from '../../src/services/productAnalytics';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => {
    useAccountStore.setState({ dialog: null, session: null, user: null });
  });
  window.history.replaceState(null, '', '/');
});

describe('creation-mode landing page', () => {
  it('keeps the live EASY mask circular after non-uniform viewport scaling', () => {
    const radius = creationModeMaskRadius(28, 0.25, 0.5);

    expect(radius).toBe('112px / 56px');
    expect(Number.parseFloat(radius) * 0.25).toBe(28);
    expect(Number.parseFloat(radius.split('/')[1] ?? '') * 0.5).toBe(28);
  });

  it('offers the three workflows as large route links', () => {
    window.history.replaceState(null, '', '/landing');
    const { container } = render(<CreationModeLandingPage />);

    expect(screen.getByRole('heading', {
      name: 'How do you want to create your video?',
    })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'MasterSelects' })).toHaveAttribute(
      'src',
      '/masterselects-metal-logo-v2.webp',
    );
    const formatMarquee = screen.getByRole('region', {
      name: 'Supported formats and the new Seedance 2.5 video model',
    });
    expect(formatMarquee).toHaveTextContent('H.264 / AVC');
    expect(formatMarquee).toHaveTextContent('ProRes 4444 XQ');
    expect(formatMarquee).toHaveTextContent('MP4');
    expect(formatMarquee).toHaveTextContent('FLV');
    const easyOption = screen.getByRole('link', { name: /EASY/i });
    const mediumOption = screen.getByRole('link', { name: /MEDIUM/i });
    const hardOption = screen.getByRole('link', { name: /HARD/i });
    expect(easyOption).toHaveAttribute('href', '/chat');
    expect(mediumOption).toHaveAttribute('href', '/medium');
    expect(hardOption).toHaveAttribute('href', '/editor');
    expect(easyOption.querySelectorAll('.creation-mode-piece')).toHaveLength(7);
    expect(mediumOption.querySelectorAll('.creation-mode-piece')).toHaveLength(7);
    expect(hardOption.querySelectorAll('.creation-mode-piece')).toHaveLength(11);
    expect(container.querySelector('[data-creation-mode-easy-viewport]')).toBeInTheDocument();
    expect(container.querySelectorAll(
      '[data-creation-mode-target="chat"][data-creation-morph-id]',
    )).toHaveLength(0);
    expect(Array.from(container.querySelectorAll(
      '[data-creation-mode-target="editor"][data-creation-morph-id]',
    )).map((element) => element.getAttribute('data-creation-morph-id'))).toEqual([
      'panel:media',
      'panel:preview',
      'panel:export',
      'panel:timeline',
    ]);
  });

  it('shows Login or the authenticated name before a creation mode is chosen', () => {
    const { rerender } = render(<CreationModeLandingPage />);
    const loginButton = screen.getByRole('button', { name: 'Login' });
    expect(loginButton).toHaveTextContent('Login');

    act(() => {
      useAccountStore.setState({
        session: { authenticated: true, provider: 'dev' },
        user: {
          avatarUrl: null,
          displayName: 'Roman Test',
          email: 'roman@example.com',
          id: 'user-1',
          lastAiModel: null,
          lastAppVersion: null,
          lastLoginAt: null,
        },
      });
    });
    rerender(<CreationModeLandingPage />);

    expect(screen.getByRole('button', { name: 'Open account for Roman Test' }))
      .toHaveTextContent('Roman Test');
  });

  it('maps explicit entries to the intended factory layouts', () => {
    expect(resolveInitialDockLayoutId('chat')).toBe(FACTORY_START_LAYOUT_ID);
    expect(resolveInitialDockLayoutId('medium')).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
    expect(resolveInitialDockLayoutId('editor')).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
  });

  it('hands regular clicks to the in-app editor transition', () => {
    const onOpenExperience = vi.fn();
    const trackSpy = vi.spyOn(productAnalytics, 'track').mockImplementation(() => undefined);
    const flushSpy = vi.spyOn(productAnalytics, 'flush').mockResolvedValue(undefined);
    render(<CreationModeLandingPage onOpenExperience={onOpenExperience} />);

    fireEvent.click(screen.getByRole('link', { name: /EASY/i }));
    fireEvent.click(screen.getByRole('link', { name: /MEDIUM/i }));
    fireEvent.click(screen.getByRole('link', { name: /HARD/i }));

    expect(onOpenExperience).toHaveBeenNthCalledWith(1, 'chat', '/chat');
    expect(onOpenExperience).toHaveBeenNthCalledWith(2, 'medium', '/medium');
    expect(onOpenExperience).toHaveBeenNthCalledWith(3, 'editor', '/editor');
    expect(trackSpy).toHaveBeenNthCalledWith(1, 'landing_option_selected', {
      experience: 'chat',
      mode: 'easy',
    });
    expect(trackSpy).toHaveBeenNthCalledWith(2, 'landing_option_selected', {
      experience: 'medium',
      mode: 'medium',
    });
    expect(trackSpy).toHaveBeenNthCalledWith(3, 'landing_option_selected', {
      experience: 'editor',
      mode: 'hard',
    });
    expect(flushSpy).toHaveBeenCalledTimes(3);
    expect(flushSpy).toHaveBeenCalledWith({ keepalive: true });
  });

  it('locks and marks the landing surface while its 800ms exit runs', () => {
    render(<CreationModeLandingPage isExiting />);

    const page = screen.getByRole('main', { hidden: true });
    expect(page).toHaveClass('is-exiting');
    expect(page).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /EASY/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /MEDIUM/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /HARD/i, hidden: true })).toHaveAttribute('tabindex', '-1');
  });

  it('becomes an overlay once the single editor behind it is ready', () => {
    render(<CreationModeLandingPage isEditorReady />);

    expect(screen.getByRole('main')).toHaveClass('is-editor-ready');
  });

  it('does not wait for the desktop chat morph target in a compact layout', async () => {
    const onEasyViewportReady = vi.fn();
    const editorStage = document.createElement('div');
    editorStage.dataset.creationModeEditorStage = '';
    document.body.appendChild(editorStage);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query === '(max-width: 900px)',
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ));

    try {
      render(
        <CreationModeLandingPage
          isEditorReady
          onEasyViewportReady={onEasyViewportReady}
        />,
      );

      await waitFor(() => expect(onEasyViewportReady).toHaveBeenCalledOnce());
      expect(screen.getByRole('main')).toHaveClass('is-live-easy-ready');
    } finally {
      editorStage.remove();
    }
  });

  it('keeps the choices hidden and inert while the live editor preview prepares', () => {
    render(<CreationModeLandingPage isPreparing />);

    const page = screen.getByRole('main', { hidden: true });
    expect(page).toHaveClass('is-preparing');
    expect(page).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /EASY/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /MEDIUM/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /HARD/i, hidden: true })).toHaveAttribute('tabindex', '-1');
  });

  it('marks the post-boot landing reveal only for its initial animation', () => {
    vi.useFakeTimers();
    try {
      render(<CreationModeLandingPage isEditorReady playInitialReveal />);

      expect(screen.getByRole('main')).toHaveClass('is-initial-reveal');
      expect(screen.getByRole('main')).not.toHaveClass('is-preparing');

      act(() => vi.advanceTimersByTime(950));

      expect(screen.getByRole('main')).not.toHaveClass('is-initial-reveal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks the choices while the editor panels animate back into them', () => {
    render(<CreationModeLandingPage isEditorReady isEntering />);

    const page = screen.getByRole('main', { hidden: true });
    expect(page).toHaveClass('is-entering');
    expect(page).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /EASY/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /MEDIUM/i, hidden: true })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /HARD/i, hidden: true })).toHaveAttribute('tabindex', '-1');
  });
});
