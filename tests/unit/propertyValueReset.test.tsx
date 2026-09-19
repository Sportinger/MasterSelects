import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/googleFontsService', () => ({
  googleFontsService: {
    loadFont: vi.fn().mockResolvedValue(undefined),
    preloadFont: vi.fn().mockResolvedValue(undefined),
    getAvailableWeights: vi.fn(() => [400, 700]),
  },
  POPULAR_FONTS: [
    { family: 'Arial' },
    { family: 'Inter' },
  ],
}));

import { TextTab } from '../../src/components/panels/TextTab';
import { CaptionTab } from '../../src/components/panels/properties/CaptionTab';
import { ThreeDTextTab } from '../../src/components/panels/properties/ThreeDTextTab';
import {
  DEFAULT_TEXT_3D_PROPERTIES,
  DEFAULT_TEXT_PROPERTIES,
  DEFAULT_TRANSFORM,
} from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  DEFAULT_CAPTION_PROPERTIES,
  createCaptionTextProperties,
} from '../../src/services/captions/captionDefaults';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

describe('property value right-click reset', () => {
  const updateTextProperties = vi.fn();
  const updateCaptionProperties = vi.fn();
  const updateText3DProperties = vi.fn();
  const ensureCaptionTextClip = vi.fn(async () => 'caption-1');

  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useTimelineStore.setState({
        clips: [],
        tracks: [],
        updateTextProperties,
        updateCaptionProperties,
        updateText3DProperties,
        ensureCaptionTextClip,
      });
    });
  });

  afterEach(() => {
    act(() => useTimelineStore.setState(initialTimelineState));
  });

  it('uses canonical regular-text defaults for numeric, font, and color controls', () => {
    render(
      <TextTab
        clipId="text-1"
        compact
        selectionPills
        textProperties={{
          ...DEFAULT_TEXT_PROPERTIES,
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: 150,
          color: '#ff0000',
        }}
      />,
    );

    fireEvent.contextMenu(screen.getByLabelText('Font Size'));
    expect(updateTextProperties).toHaveBeenCalledWith('text-1', {
      fontSize: DEFAULT_TEXT_PROPERTIES.fontSize,
    });

    fireEvent.contextMenu(screen.getByRole('combobox', { name: 'Font family' }));
    expect(updateTextProperties).toHaveBeenCalledWith('text-1', {
      fontFamily: DEFAULT_TEXT_PROPERTIES.fontFamily,
      fontWeight: DEFAULT_TEXT_PROPERTIES.fontWeight,
    });
    expect(screen.getByRole('combobox', { name: 'Font weight' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Font style' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByLabelText('Fill color picker'));
    expect(updateTextProperties).toHaveBeenCalledWith('text-1', {
      color: DEFAULT_TEXT_PROPERTIES.color,
    });
  });

  it('uses shared inspector sections and dropdowns for 3D text settings', () => {
    const { container } = render(
      <ThreeDTextTab
        clipId="text3d-1"
        text3DProperties={DEFAULT_TEXT_3D_PROPERTIES}
      />,
    );

    expect(screen.getByRole('button', { name: 'Text', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Geometry', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scale', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '3D text font' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '3D text font weight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bevel', exact: true })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.properties-section')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Bevel' }));
    expect(updateText3DProperties).toHaveBeenCalledWith('text3d-1', { bevelEnabled: true });
  });

  it('uses caption defaults for caption-owned text and caption selects', () => {
    const captionProperties = structuredClone(DEFAULT_CAPTION_PROPERTIES);
    captionProperties.textTransform = 'uppercase';
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const captionTextProperties = createCaptionTextProperties({
      caption: DEFAULT_CAPTION_PROPERTIES,
      base: DEFAULT_TEXT_PROPERTIES,
      width: canvas.width,
      height: canvas.height,
    });
    captionTextProperties.fontSize = 120;
    const clip = {
      id: 'caption-1',
      trackId: 'video-1',
      name: 'Caption',
      file: new File([], 'caption.dat'),
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'text', naturalDuration: 5, textCanvas: canvas },
      transform: structuredClone(DEFAULT_TRANSFORM),
      effects: [],
      textProperties: captionTextProperties,
      captionProperties,
      isLoading: false,
    } satisfies TimelineClip;
    act(() => useTimelineStore.setState({ clips: [clip] }));

    render(<CaptionTab clipId={clip.id} properties={captionProperties} />);

    expect(document.querySelectorAll('select')).toHaveLength(1);
    const sourceSelect = screen.getByLabelText('Transcript source');
    sourceSelect.focus();
    expect(sourceSelect).toHaveFocus();
    fireEvent.wheel(sourceSelect, { deltaY: 100 });
    expect(sourceSelect).not.toHaveFocus();
    expect(updateCaptionProperties).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'UPPERCASE' }));
    expect(updateCaptionProperties).toHaveBeenCalledWith(clip.id, {
      textTransform: DEFAULT_CAPTION_PROPERTIES.textTransform,
    });

    fireEvent.click(screen.getByRole('button', { name: 'lowercase' }));
    expect(updateCaptionProperties).toHaveBeenCalledWith(clip.id, {
      textTransform: 'lowercase',
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Font weight' }));
    const weightOptions = within(screen.getByRole('listbox'));
    expect(weightOptions.getAllByRole('option')).toHaveLength(9);
    expect(weightOptions.getByRole('option', { name: 'Thin' })).toBeDisabled();
    expect(weightOptions.getByRole('option', { name: 'Bold' })).toBeEnabled();
    expect(weightOptions.getByRole('option', { name: 'Bold' })).toHaveStyle({
      fontFamily: 'Inter',
      fontWeight: '700',
    });
    fireEvent.click(weightOptions.getByRole('option', { name: 'Bold' }));
    expect(updateTextProperties).toHaveBeenCalledWith(clip.id, {
      fontWeight: 700,
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Font style' }));
    expect(screen.getByRole('option', { name: 'Italic' })).toHaveStyle({
      fontFamily: 'Inter',
      fontStyle: 'italic',
    });

    const linesControl = screen.getByText('Lines').closest('.labeled-value')
      ?.querySelector('.draggable-number');
    expect(linesControl).not.toBeNull();
    fireEvent.contextMenu(linesControl!);
    expect(updateCaptionProperties).toHaveBeenCalledWith(clip.id, {
      maxLines: DEFAULT_CAPTION_PROPERTIES.maxLines,
    });

    fireEvent.contextMenu(screen.getByLabelText('Font Size'));
    expect(updateTextProperties).toHaveBeenCalledWith(clip.id, {
      fontSize: DEFAULT_CAPTION_PROPERTIES.fontSize,
    });
  });
});
