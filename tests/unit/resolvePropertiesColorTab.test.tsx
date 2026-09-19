import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/settingsStore');

import { PropertiesClipTabStrip } from '../../src/components/panels/properties/PropertiesClipTabStrip';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { ClipPropertiesPresentation } from '../../src/components/panels/properties/propertiesPanelTypes';

const PRESENTATION: ClipPropertiesPresentation = {
  isStoryboardClip: false,
  isAudioClip: false,
  isCameraClip: false,
  isMathSceneClip: false,
  isFlockClip: false,
  isMotionAdjustmentClip: false,
  isMotionShapeClip: false,
  isEditableHookClip: false,
  isCaptionClip: false,
  isTextClip: false,
  is3DTextClip: false,
  isLiveInputClip: false,
  isVectorAnimationClip: false,
  vectorAnimationTabLabel: 'Lottie',
  isModelClip: false,
  isGaussianAvatar: false,
  isGaussianSplat: false,
  isLightClip: false,
  isSplatEffectorClip: false,
  isSolidClip: false,
};

function renderStrip() {
  const onTabChange = vi.fn();
  render(
    <PropertiesClipTabStrip
      activeTab="transform"
      onTabChange={onTabChange}
      presentation={PRESENTATION}
      visualEffectCount={0}
      audioEditCount={0}
      maskCount={0}
      sourceAnalysisReady={false}
    />,
  );
  return onTabChange;
}

afterEach(() => {
  cleanup();
  useSettingsStore.setState({ theme: 'dark' });
});

describe('Resolve Properties color routing', () => {
  it('keeps the Color/Image tab usable in Resolve Properties', () => {
    useSettingsStore.setState({ theme: 'resolve' });
    const onTabChange = renderStrip();

    fireEvent.click(screen.getByText('Image'));

    expect(onTabChange).toHaveBeenCalledWith('color');
  });

  it('keeps the Color tab in non-Resolve themes', () => {
    useSettingsStore.setState({ theme: 'dark' });
    renderStrip();
    expect(screen.getByText('Color')).toBeInTheDocument();
  });

  it('keeps Live Input controls inside Transform instead of a separate tab', () => {
    useSettingsStore.setState({ theme: 'dark' });
    render(
      <PropertiesClipTabStrip
        activeTab="transform"
        onTabChange={vi.fn()}
        presentation={{ ...PRESENTATION, isLiveInputClip: true }}
        visualEffectCount={0}
        audioEditCount={0}
        maskCount={0}
        sourceAnalysisReady={false}
      />,
    );

    expect(screen.getByText('Transform')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });
});
