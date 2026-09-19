import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  const editorState = {
    assetId: null as string | null,
    message: '',
    setEditor: vi.fn(),
  };
  return {
    timelineState: {
      clips: [] as any[],
      tracks: [{id: 'video-track', locked: false}],
      isExporting: false,
      updateClip: vi.fn(),
    },
    trackingState: {assets: [] as any[]},
    editorState,
    bindClipToTrackingAsset: vi.fn(),
    invalidateCache: vi.fn(),
    requestRender: vi.fn(),
  };
});

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(
    (selector: (state: typeof fakes.timelineState) => unknown) => selector(fakes.timelineState),
    {getState: () => fakes.timelineState},
  ),
}));

vi.mock('../../src/stores/trackingStore', () => ({
  useTrackingStore: (selector: (state: typeof fakes.trackingState) => unknown) => selector(fakes.trackingState),
}));

vi.mock('../../src/stores/trackingEditorStore', () => ({
  useTrackingEditorStore: Object.assign(
    (selector: (state: typeof fakes.editorState) => unknown) => selector(fakes.editorState),
    {getState: () => fakes.editorState},
  ),
}));

vi.mock('../../src/services/planarTracking/trackingBinding', () => ({
  bindClipToTrackingAsset: fakes.bindClipToTrackingAsset,
}));
vi.mock('../../src/services/planarTracking/trackingAssetActions', () => ({
  requestTrackingAssetAction: vi.fn(),
}));
vi.mock('../../src/services/layerBuilder', () => ({
  layerBuilder: {invalidateCache: fakes.invalidateCache},
}));
vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {requestRender: fakes.requestRender},
}));
vi.mock('../../src/components/panels/properties/surfaceTracking/TerrainAttachmentControls', () => ({
  TerrainAttachmentControls: () => <div>Legacy controls</div>,
}));

import { TrackingConnectionControls } from '../../src/components/panels/properties/surfaceTracking/TrackingConnectionControls';

function makeAsset(id: string, trackId: string) {
  return {id, name: id, track: {id: trackId}};
}

function makeClip(id: string, assetId?: string, mode: 'follow' | 'surface' = 'follow') {
  return {
    id,
    trackId: 'video-track',
    ...(assetId ? {
      trackingBinding: {
        version: 1,
        assetId,
        mode,
        point: {x: .5, y: .5},
        offset: {x: 0, y: 0},
      },
    } : {}),
  };
}

describe('TrackingConnectionControls', () => {
  beforeEach(() => {
    fakes.editorState.assetId = null;
    fakes.editorState.message = '';
    fakes.editorState.setEditor.mockReset().mockImplementation((patch: Record<string, unknown>) => {
      Object.assign(fakes.editorState, patch);
    });
    fakes.trackingState.assets = [
      makeAsset('asset-a', 'track-a'),
      makeAsset('asset-b', 'track-b'),
      makeAsset('asset-legacy', 'track-legacy'),
    ];
    fakes.timelineState.clips = [];
    fakes.timelineState.updateClip.mockReset();
    fakes.bindClipToTrackingAsset.mockReset();
    fakes.invalidateCache.mockReset();
    fakes.requestRender.mockReset();
  });

  it('switches to each clip bound asset and preserves its binding mode', () => {
    fakes.timelineState.clips = [
      makeClip('clip-a', 'asset-a', 'surface'),
      makeClip('clip-b', 'asset-b', 'follow'),
    ];

    const view = render(<TrackingConnectionControls clipId="clip-a" />);
    expect(screen.getByRole('combobox', {name: 'Connect tracking result'})).toHaveValue('asset-a');
    expect(screen.getByRole('button', {name: 'Project onto surface'})).toHaveAttribute('aria-pressed', 'true');

    view.rerender(<TrackingConnectionControls clipId="clip-b" />);

    expect(screen.getByRole('combobox', {name: 'Connect tracking result'})).toHaveValue('asset-b');
    expect(screen.getByRole('button', {name: 'Follow position'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: 'Project onto surface'})).toHaveAttribute('aria-pressed', 'false');
  });

  it('connects the result chosen in the dropdown and clears stale messages', () => {
    fakes.timelineState.clips = [makeClip('clip-a', 'asset-a', 'surface')];
    fakes.editorState.message = 'Old placement message';
    render(<TrackingConnectionControls clipId="clip-a" />);

    fireEvent.change(screen.getByRole('combobox', {name: 'Connect tracking result'}), {
      target: {value: 'asset-b'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Follow position'}));

    expect(fakes.bindClipToTrackingAsset).toHaveBeenCalledWith('clip-a', 'asset-b', 'follow');
    expect(fakes.editorState.setEditor).toHaveBeenCalledWith({message: ''});
    expect(fakes.invalidateCache).toHaveBeenCalled();
    expect(fakes.requestRender).toHaveBeenCalled();
  });

  it('prefers a legacy attachment match over a pending global asset', () => {
    fakes.editorState.assetId = 'asset-b';
    fakes.timelineState.clips = [{
      ...makeClip('legacy-clip'),
      terrainAttachment: {trackId: 'track-legacy'},
    }];

    render(<TrackingConnectionControls clipId="legacy-clip" />);

    expect(screen.getByRole('combobox', {name: 'Connect tracking result'})).toHaveValue('asset-legacy');
  });

  it('clears a failed connection error when the selected clip changes', () => {
    fakes.timelineState.clips = [makeClip('clip-a'), makeClip('clip-b')];
    fakes.editorState.assetId = 'asset-a';
    fakes.bindClipToTrackingAsset.mockImplementationOnce(() => {
      throw new Error('Cannot connect result');
    });
    const view = render(<TrackingConnectionControls clipId="clip-a" />);
    fireEvent.click(screen.getByRole('button', {name: 'Follow position'}));
    expect(screen.getByRole('status')).toHaveTextContent('Cannot connect result');

    view.rerender(<TrackingConnectionControls clipId="clip-b" />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
