import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionAppearanceStackEditor } from '../../src/components/panels/properties/MotionAppearanceStackEditor';
import { handleUpdateMotionAppearances } from '../../src/services/aiTools/handlers/motionDesign';
import { createMotionAppearancePreset } from '../../src/services/motionDesign/appearancePresets';
import { getMotionMvpCapabilities } from '../../src/services/motionDesign/mvpCapabilities';
import { createTextureFillAppearance } from '../../src/types/motionDesign';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();

// tests/setup.ts globally mocks the media store: the hook ignores selectors
// and returns {}, getState returns a static object, setState is a no-op
// vi.fn. Installing media files means overriding BOTH the hook (selector
// applied to fixture state) and getState — never calling setState.
const mockedMediaHook = vi.mocked(useMediaStore);
const mockedMediaGetState = vi.mocked(useMediaStore.getState);
const defaultMediaHookImpl = mockedMediaHook.getMockImplementation();
const defaultMediaGetStateImpl = mockedMediaGetState.getMockImplementation();

function installMediaFiles(files: MediaFile[]): void {
  const mediaState = { ...(defaultMediaGetStateImpl?.() ?? {}), files };
  mockedMediaGetState.mockReturnValue(mediaState as never);
  mockedMediaHook.mockImplementation(((selector?: (state: unknown) => unknown) =>
    selector ? selector(mediaState) : mediaState) as never);
}

describe('Motion appearance texture authoring MD5', () => {
  let clipId: string;

  beforeEach(() => {
    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [],
      tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false }],
      clipKeyframes: new Map(),
    });
    clipId = useTimelineStore.getState().addMotionShapeClip(
      'video-1', 0, { primitive: 'rectangle', duration: 5 },
    )!;
    installMediaFiles([{
      id: 'texture-image', name: 'Texture.png', type: 'image', parentId: null,
      createdAt: 1, url: 'blob:texture-image',
    } satisfies MediaFile]);
  });

  afterEach(() => act(() => {
    useTimelineStore.setState(initialTimelineState);
    if (defaultMediaGetStateImpl) mockedMediaGetState.mockImplementation(defaultMediaGetStateImpl);
    if (defaultMediaHookImpl) mockedMediaHook.mockImplementation(defaultMediaHookImpl);
  }));

  it('adds texture fills through AI operations and validates texture inputs', async () => {
    const add = await handleUpdateMotionAppearances({
      clipId,
      operations: [{
        operation: 'add', kind: 'texture-fill', mediaFileId: 'texture-image',
        fit: 'cover', time: 1.5,
        transform: { position: { x: 0.25, y: -0.25 }, scale: { x: 2, y: 1 }, rotation: 30 },
      }],
    }, useTimelineStore.getState());
    expect(add.success).toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.appearance?.items)
      .toContainEqual(expect.objectContaining({ kind: 'texture-fill', mediaFileId: 'texture-image' }));

    for (const invalid of [
      { fit: 'invalid-fit' },
      { time: -1 },
      { mediaFileId: '' },
    ]) {
      const result = await handleUpdateMotionAppearances({
        clipId,
        operations: [{ operation: 'add', kind: 'texture-fill', ...invalid }],
      }, useTimelineStore.getState());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/fit|time|mediaFileId/);
    }
  });

  it('does not advertise texture appearances as unsupported', () => {
    const unsupported = getMotionMvpCapabilities().unsupportedUntilLaterPhases.join(' ');
    expect(unsupported).not.toContain('texture');
    expect(unsupported).toContain('motion group');
  });

  it('authors media and numeric texture fields in the appearance editor', () => {
    render(createElement(MotionAppearanceStackEditor, { clipId }));
    fireEvent.change(screen.getByLabelText('Add appearance'), { target: { value: 'texture-fill' } });
    expect(screen.getByLabelText('Texture media')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Texture media'), { target: { value: 'texture-image' } });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.appearance?.items)
      .toContainEqual(expect.objectContaining({ kind: 'texture-fill', mediaFileId: 'texture-image' }));

    fireEvent.doubleClick(screen.getByText('0.00s'));
    const input = screen.getByTitle('Enter value');
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.appearance?.items)
      .toContainEqual(expect.objectContaining({ kind: 'texture-fill', time: 2.5 }));
  });

  it('keeps the intentional texture-fill preset guard', () => {
    expect(() => createMotionAppearancePreset({ version: 1, items: [createTextureFillAppearance()] }, 'Texture'))
      .toThrow('cannot embed texture');
  });
});
