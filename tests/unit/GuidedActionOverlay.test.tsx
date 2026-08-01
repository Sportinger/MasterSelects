import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuidedActionOverlay } from '../../src/components/guidedActions/GuidedActionOverlay';
import {
  getGuidedTargetKey,
  normalizeGuidedAnimationBudget,
  planGuidedActions,
} from '../../src/services/guidedActions';
import { useGuidedActionStore } from '../../src/stores/guidedActionStore';
import type {
  GuidedAction,
  GuidedRect,
  GuidedSessionSnapshot,
  GuidedTargetRef,
} from '../../src/services/guidedActions';

describe('GuidedActionOverlay', () => {
  afterEach(() => {
    cleanup();
    resetGuidedActionStore();
  });

  it('renders the guided visual layer from store state', () => {
    const target: GuidedTargetRef = { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' };
    const actions: GuidedAction[] = [
      { type: 'highlightTarget', target, label: 'Highlight transform', durationMs: 400 },
    ];
    const budget = normalizeGuidedAnimationBudget({ totalMs: 1000, compression: 'none' });
    const plan = planGuidedActions(actions, budget);
    const session: GuidedSessionSnapshot = {
      id: 'overlay-test',
      status: 'running',
      label: 'Overlay test',
      context: {
        sessionId: 'overlay-test',
        callerContext: 'chat',
        playbackMode: 'aiReplay',
        visualizationMode: 'full',
        animationBudget: budget,
        inputLock: { mode: 'locked', allowCancel: true },
        legacyFeedback: 'native',
      },
      startedAt: 10,
      plan,
    };

    useGuidedActionStore.setState({
      activeSession: session,
      currentStep: plan.actions[0] ?? null,
      cursor: {
        visible: true,
        position: { x: 160, y: 90 },
        clicking: true,
        inputGesture: { kind: 'mouse-left', label: 'LMB', detail: 'Click' },
      },
      spotlight: target,
      callout: { title: 'Adjust position', body: 'Drag the X value.', target },
      highlights: [{
        id: 'highlight-1',
        target,
        tone: 'primary',
        createdAt: 10,
      }],
      previewPaths: [{
        id: 'path-1',
        points: [{ x: 10, y: 10 }, { x: 40, y: 40 }],
        closed: false,
        createdAt: 10,
      }],
      targetResolutions: {
        [getGuidedTargetKey(target)]: {
          status: 'resolved',
          target,
          rect: { x: 120, y: 60, width: 80, height: 24 },
          center: { x: 160, y: 72 },
        },
      },
    });

    const { container } = render(<GuidedActionOverlay />);

    expect(screen.getByText('Highlight transform')).toBeTruthy();
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText('Adjust position')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel guided action' })).toBeTruthy();
    const callout = container.querySelector<HTMLElement>('.guided-callout');
    expect(callout).not.toBeNull();
    expect(callout?.style.left).toBe('');
    expect(callout?.style.top).toBe('');
    expect(container.querySelector('.guided-cursor--clicking')).not.toBeNull();
    expect(screen.getByText('LMB')).toBeTruthy();
    expect(container.querySelector('.guided-spotlight')).not.toBeNull();
    expect(container.querySelector('.guided-target-highlight--primary')).not.toBeNull();
    expect(container.querySelector('.guided-preview-path')).not.toBeNull();
  });

  it('keeps all target-only allowed rectangles open', () => {
    const firstTarget: GuidedTargetRef = { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' };
    const secondTarget: GuidedTargetRef = { kind: 'button', id: 'apply-transform' };
    const actions: GuidedAction[] = [
      { type: 'waitForUserAction', check: { kind: 'targetResolved', target: firstTarget }, timeoutMs: 1000 },
    ];
    const budget = normalizeGuidedAnimationBudget({ totalMs: 1000, compression: 'none' });
    const plan = planGuidedActions(actions, budget);
    const session: GuidedSessionSnapshot = {
      id: 'target-only-test',
      status: 'running',
      context: {
        sessionId: 'target-only-test',
        callerContext: 'internal',
        playbackMode: 'guidedUser',
        visualizationMode: 'full',
        animationBudget: budget,
        inputLock: { mode: 'targetOnly', targets: [firstTarget, secondTarget] },
        legacyFeedback: 'native',
      },
      startedAt: 10,
      plan,
    };

    useGuidedActionStore.setState({
      activeSession: session,
      currentStep: plan.actions[0] ?? null,
      targetResolutions: {
        [getGuidedTargetKey(firstTarget)]: {
          status: 'resolved',
          target: firstTarget,
          rect: { x: 120, y: 60, width: 80, height: 24 },
          center: { x: 160, y: 72 },
        },
        [getGuidedTargetKey(secondTarget)]: {
          status: 'resolved',
          target: secondTarget,
          rect: { x: 300, y: 80, width: 60, height: 30 },
          center: { x: 330, y: 95 },
        },
      },
    });

    const { container } = render(<GuidedActionOverlay />);
    const shieldSegments = Array.from(container.querySelectorAll<HTMLElement>('.guided-input-shield--segment'))
      .map(getInlineRect);

    expect(screen.getByRole('button', { name: 'Cancel guided action' })).toBeTruthy();
    expect(shieldSegments.length).toBeGreaterThan(4);
    expect(shieldSegments.some((rect) => rectContainsPoint(rect, 160, 72))).toBe(false);
    expect(shieldSegments.some((rect) => rectContainsPoint(rect, 330, 95))).toBe(false);
    expect(shieldSegments.some((rect) => rectContainsPoint(rect, 20, 20))).toBe(true);
  });

  it('does not render for visual-off or disabled replay sessions', () => {
    const target: GuidedTargetRef = { kind: 'propertyControl', property: 'position.x', clipId: 'clip-1' };
    const actions: GuidedAction[] = [
      { type: 'highlightTarget', target, label: 'Hidden highlight', durationMs: 400 },
    ];
    const budget = normalizeGuidedAnimationBudget({ totalMs: 0, compression: 'none' });
    const plan = planGuidedActions(actions, budget);
    const session: GuidedSessionSnapshot = {
      id: 'instant-test',
      status: 'running',
      label: 'Instant test',
      context: {
        sessionId: 'instant-test',
        callerContext: 'chat',
        playbackMode: 'aiReplay',
        visualizationMode: 'off',
        animationBudget: budget,
        inputLock: { mode: 'locked', allowCancel: true },
        legacyFeedback: 'off',
      },
      startedAt: 10,
      plan,
    };

    useGuidedActionStore.setState({
      activeSession: session,
      currentStep: plan.actions[0] ?? null,
      cursor: { visible: true, position: { x: 160, y: 90 }, clicking: true, inputGesture: null },
      spotlight: target,
      callout: { title: 'Should not render', target },
      highlights: [{
        id: 'highlight-hidden',
        target,
        tone: 'primary',
        createdAt: 10,
      }],
      targetResolutions: {
        [getGuidedTargetKey(target)]: {
          status: 'resolved',
          target,
          rect: { x: 120, y: 60, width: 80, height: 24 },
          center: { x: 160, y: 72 },
        },
      },
    });

    const { container } = render(<GuidedActionOverlay />);

    expect(container.querySelector('.guided-action-overlay')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel guided action' })).toBeNull();
  });

  it('does not leave the overlay visible after a failed session', () => {
    const actions: GuidedAction[] = [{ type: 'delay', ms: 100 }];
    const budget = normalizeGuidedAnimationBudget({ totalMs: 100, compression: 'none' });
    const session: GuidedSessionSnapshot = {
      id: 'failed-tutorial',
      status: 'failed',
      error: 'Target disappeared',
      context: {
        sessionId: 'failed-tutorial',
        callerContext: 'internal',
        playbackMode: 'tutorialDemo',
        visualizationMode: 'full',
        animationBudget: budget,
        inputLock: { mode: 'locked', allowCancel: true },
        legacyFeedback: 'off',
      },
      startedAt: 10,
      finishedAt: 20,
      plan: planGuidedActions(actions, budget),
    };

    useGuidedActionStore.setState({
      activeSession: session,
      callout: { title: 'Stale tutorial state' },
      spotlight: { kind: 'panel', panel: 'timeline' },
    });

    const { container } = render(<GuidedActionOverlay />);

    expect(container.querySelector('.guided-action-overlay')).toBeNull();
    expect(screen.queryByText('Stale tutorial state')).toBeNull();
  });

  it('does not flash a full-window spotlight while a target is unresolved', () => {
    const target: GuidedTargetRef = { kind: 'panel', panel: 'media' };
    const actions: GuidedAction[] = [{ type: 'spotlight', target }];
    const budget = normalizeGuidedAnimationBudget({ totalMs: 100, compression: 'none' });
    const session: GuidedSessionSnapshot = {
      id: 'unresolved-spotlight',
      status: 'running',
      metadata: { presentation: 'panel-overview' },
      context: {
        sessionId: 'unresolved-spotlight',
        callerContext: 'internal',
        playbackMode: 'tutorialDemo',
        visualizationMode: 'full',
        animationBudget: budget,
        inputLock: { mode: 'locked', allowCancel: true },
        legacyFeedback: 'off',
      },
      startedAt: 10,
      plan: planGuidedActions(actions, budget),
    };

    useGuidedActionStore.setState({
      activeSession: session,
      callout: { title: 'Media', body: 'Your source material lives here.', target },
      currentStep: session.plan.actions[0] ?? null,
      spotlight: target,
      targetResolutions: {},
    });

    const { container } = render(<GuidedActionOverlay />);

    expect(container.querySelector('.guided-action-overlay')).not.toBeNull();
    expect(container.querySelector('.guided-spotlight')).toBeNull();
    expect(screen.queryByText('Left click')).not.toBeInTheDocument();
    expect(screen.queryByText('Right click')).not.toBeInTheDocument();
    const embeddedHud = container.querySelector('.guided-step-hud--embedded');
    expect(embeddedHud).not.toBeNull();
    expect(container.querySelector('.guided-callout')?.contains(embeddedHud)).toBe(true);
    expect(container.querySelector('.guided-clippy-wrapper')).not.toBeNull();
    expect(container.querySelector('source[src="/clippy-intro.webm"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'End walkthrough' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip guided action' })).toBeNull();
  });
});

function resetGuidedActionStore(): void {
  useGuidedActionStore.setState({
    activeSession: null,
    currentStep: null,
    cursor: { visible: false, position: null, clicking: false, inputGesture: null },
    lastUserPointerPosition: null,
    spotlight: null,
    callout: null,
    highlights: [],
    previewPaths: [],
    targetResolutions: {},
    diagnostics: [],
    eventLog: [],
  });
}

function getInlineRect(element: HTMLElement): GuidedRect {
  return {
    x: Number.parseFloat(element.style.left || '0'),
    y: Number.parseFloat(element.style.top || '0'),
    width: Number.parseFloat(element.style.width || '0'),
    height: Number.parseFloat(element.style.height || '0'),
  };
}

function rectContainsPoint(rect: GuidedRect, x: number, y: number): boolean {
  return x >= rect.x
    && x <= rect.x + rect.width
    && y >= rect.y
    && y <= rect.y + rect.height;
}
