import { useState } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractiveTutorialOverlay } from '../../src/components/common/tutorial/InteractiveTutorialOverlay';
import { INTERACTIVE_CAMPAIGNS } from '../../src/components/common/tutorial/interactiveCampaigns';
import { requestTutorialNavigation } from '../../src/components/common/tutorial/tutorialNavigationController';
import {
  getGuidedActionRuntime,
  guidedTargetRegistry,
  registerDomGuidedTargetResolvers,
} from '../../src/services/guidedActions';
import { useGuidedActionStore } from '../../src/stores/guidedActionStore';

describe('InteractiveTutorialOverlay', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    getGuidedActionRuntime().cancelSession(undefined, 'Test cleanup');
    useGuidedActionStore.getState().clearSession();
  });

  it('uses left click for next and right click for back', async () => {
    const campaign = INTERACTIVE_CAMPAIGNS[0]!;
    const onCancel = vi.fn();
    const onClose = vi.fn();
    const onSkip = vi.fn();

    render(
      <InteractiveTutorialOverlay
        campaign={campaign}
        onCancel={onCancel}
        onClose={onClose}
        onSkip={onSkip}
      />,
    );

    await expectTutorialStep(1);

    navigate('next');
    await expectTutorialStep(2);

    navigate('previous');
    await expectTutorialStep(1);

    navigate('next');
    await expectTutorialStep(2);
    navigate('next');
    await expectTutorialStep(3);
    navigate('next');
    await expectTutorialStep(4);
    navigate('next');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getGuidedActionRuntime().getActiveSessionId()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('releases each guided session and plays every tutorial chapter in sequence', async () => {
    const onCancel = vi.fn();

    render(<TutorialChainHarness onCancel={onCancel} />);

    await expectTutorialStep(1, 4);
    navigate('next');
    await expectTutorialStep(2, 4);
    navigate('next');
    await expectTutorialStep(3, 4);
    navigate('next');
    await expectTutorialStep(4, 4);
    navigate('next');

    await expectTutorialStep(1, 5);
    expect(useGuidedActionStore.getState().activeSession?.metadata?.scenarioId).toBe(
      INTERACTIVE_CAMPAIGNS[1]!.id,
    );

    navigate('next');
    await expectTutorialStep(2, 5);
    navigate('next');
    await expectTutorialStep(3, 5);
    navigate('next');
    await expectTutorialStep(4, 5);
    navigate('next');
    await expectTutorialStep(5, 5);
    navigate('next');

    await expectTutorialStep(1, 5);
    expect(useGuidedActionStore.getState().activeSession?.metadata?.scenarioId).toBe(
      INTERACTIVE_CAMPAIGNS[2]!.id,
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('moves the visual cursor to layout controls and shows the drag gesture', async () => {
    const unregisterResolvers = registerDomGuidedTargetResolvers(guidedTargetRegistry);
    const propertiesPanel = addTarget('data-panel-type', 'clip-properties', {
      x: 900,
      y: 100,
      width: 300,
      height: 500,
    });
    const propertiesTab = addTarget('data-guided-target', 'panel-tab:clip-properties', {
      x: 910,
      y: 75,
      width: 110,
      height: 25,
    });
    addTarget('data-panel-type', 'preview', {
      x: 400,
      y: 100,
      width: 500,
      height: 500,
    });
    propertiesPanel.appendChild(propertiesTab);

    render(
      <InteractiveTutorialOverlay
        campaign={INTERACTIVE_CAMPAIGNS[1]!}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await expectTutorialStep(1, 5);
    navigate('next');
    await expectTutorialStep(2, 5);
    await waitFor(() => {
      expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
        inputGesture: expect.objectContaining({ label: 'Hold + drag' }),
        position: { x: 965, y: 87.5 },
        visible: true,
      }));
    });

    unregisterResolvers();
  });
});

function TutorialChainHarness({ onCancel }: { onCancel: () => void }) {
  const [campaignIndex, setCampaignIndex] = useState(0);
  const campaign = INTERACTIVE_CAMPAIGNS[campaignIndex];
  if (!campaign) return null;

  return (
    <InteractiveTutorialOverlay
      key={campaign.id}
      campaign={campaign}
      onCancel={onCancel}
      onClose={() => setCampaignIndex((current) => current + 1)}
      onSkip={onCancel}
    />
  );
}

async function expectTutorialStep(current: number, total = 4): Promise<void> {
  await waitFor(() => {
    expect(useGuidedActionStore.getState().activeSession?.metadata?.tutorialProgress).toEqual(
      expect.objectContaining({ current, total }),
    );
  });
}

function addTarget(
  attribute: string,
  value: string,
  rect: { x: number; y: number; width: number; height: number },
): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(attribute, value);
  element.getBoundingClientRect = () => ({
    ...rect,
    bottom: rect.y + rect.height,
    left: rect.x,
    right: rect.x + rect.width,
    top: rect.y,
    toJSON: () => rect,
  });
  document.body.appendChild(element);
  return element;
}

function navigate(direction: 'next' | 'previous'): void {
  act(() => {
    expect(requestTutorialNavigation(direction)).toBe(true);
  });
}
