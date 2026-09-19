import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../../src/components/panels/properties';
import { resolveEditableHookLayerMetadata } from '../../src/services/aiTools/editableHookIdentity';
import { handleManageEditableHook } from '../../src/services/aiTools/handlers/editableHook';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { ColorFillAppearance } from '../../src/types/motionDesign';
import {
  installEditableHookMediaSimulation,
  type EditableHookMediaSimulation,
} from './helpers/editableHookMediaSimulation';

vi.mock('../../src/services/googleFontsService', () => ({
  POPULAR_FONTS: [
    { family: 'Arial', weights: [400, 700, 800, 900], category: 'sans-serif' },
    { family: 'Roboto', weights: [400, 700, 900], category: 'sans-serif' },
  ],
  googleFontsService: {
    getAvailableWeights: () => [400, 700, 800, 900],
    loadFont: vi.fn().mockResolvedValue(undefined),
    preloadFont: vi.fn().mockResolvedValue(undefined),
  },
}));

const initialTimelineState = useTimelineStore.getState();
let mediaSimulation: EditableHookMediaSimulation;

const composition: Composition = {
  id: 'hook-ui-composition',
  name: 'Hook UI Test',
  type: 'composition',
  parentId: null,
  createdAt: 1,
  width: 1080,
  height: 1920,
  frameRate: 30,
  duration: 30,
  backgroundColor: '#000000',
};

function installMediaState(): void {
  // Hooks are created inside their own subcomposition, so the media store must
  // be able to create compositions and switch tabs (see the shared simulation).
  mediaSimulation = installEditableHookMediaSimulation(composition, {
    selectedSlotCompositionId: null,
    slotAssignments: {},
    selectSlotComposition: vi.fn(),
    ensureSlotClipSettings: vi.fn(),
  } as Partial<ReturnType<typeof useMediaStore.getState>>);
}

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [{
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 70,
      muted: false,
      visible: true,
      solo: false,
    }],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    playheadPosition: 2,
    clipKeyframes: new Map(),
  });
}

function fillForBackground(clipId: string): ColorFillAppearance {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)!;
  return clip.motion!.appearance!.items.find(
    (item): item is ColorFillAppearance => item.kind === 'color-fill',
  )!;
}

describe('Hook properties tab', () => {
  beforeEach(() => {
    installMediaState();
    resetTimeline();
  });

  afterEach(() => {
    act(() => useTimelineStore.setState(initialTimelineState));
    mediaSimulation.restore();
  });

  it('opens beside Text and edits the grouped hook backgrounds and visible gap', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-ui-1',
      rows: [
        { text: 'FIRST ROW', backgroundColor: '#111111' },
        { text: 'SECOND ROW', backgroundColor: '#222222' },
      ],
      placement: { x: 100, y: 300, width: 800, rowHeight: 120, gap: 0 },
      style: { paddingX: 30, paddingY: 20, cornerRadius: 18 },
    }, useTimelineStore.getState());
    expect(created.success, JSON.stringify(created)).toBe(true);
    // The hook now lives in its own subcomposition; open it so the Properties
    // panel sees the hook clips in the active timeline.
    await act(async () => {
      await mediaSimulation.openHookComposition('hook-ui-1');
    });

    const identities = resolveEditableHookLayerMetadata(
      useTimelineStore.getState().clips,
      useTimelineStore.getState().tracks,
    );
    const textClip = useTimelineStore.getState().clips.find(
      (clip) => identities.get(clip.id)?.id === 'hook-ui-1' && identities.get(clip.id)?.role === 'text',
    )!;

    act(() => {
      useTimelineStore.setState({
        selectedClipIds: new Set([textClip.id]),
        primarySelectedClipId: textClip.id,
        propertiesSelection: { kind: 'clip', clipId: textClip.id },
      });
    });

    const { container } = render(<PropertiesPanel />);

    expect(await screen.findByRole('button', { name: 'Hook' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
    expect(await screen.findByText('Background')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#336699' } });

    const backgroundRows = useTimelineStore.getState().clips
      .filter((clip) => identities.get(clip.id)?.id === 'hook-ui-1' && identities.get(clip.id)?.role === 'background')
      .sort((left, right) => identities.get(left.id)!.rowIndex - identities.get(right.id)!.rowIndex);
    expect(backgroundRows).toHaveLength(2);
    for (const background of backgroundRows) {
      expect(fillForBackground(background.id).color).toMatchObject({
        r: 0x33 / 255,
        g: 0x66 / 255,
        b: 0x99 / 255,
      });
    }

    fireEvent.doubleClick(screen.getByLabelText('Hook gap'));
    const gapInput = screen.getByLabelText('Hook gap');
    fireEvent.change(gapInput, { target: { value: '12' } });
    fireEvent.blur(gapInput);

    await waitFor(() => {
      const currentBackgrounds = backgroundRows.map((background) => (
        useTimelineStore.getState().clips.find((clip) => clip.id === background.id)!
      ));
      const first = currentBackgrounds[0]!;
      const second = currentBackgrounds[1]!;
      const firstHeight = first.motion!.shape!.size.h;
      const secondHeight = second.motion!.shape!.size.h;
      const firstBottom = first.transform.position.y + composition.height / 2 + firstHeight / 2;
      const secondTop = second.transform.position.y + composition.height / 2 - secondHeight / 2;
      expect(secondTop - firstBottom).toBeCloseTo(12, 5);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    expect(await screen.findByLabelText('Font Size')).toHaveClass('draggable-number');
    expect(screen.getByLabelText('Font Size').closest('.labeled-value')).not.toBeNull();
    expect(container.querySelector('.tt-compact-num')).toBeNull();
  });
});
