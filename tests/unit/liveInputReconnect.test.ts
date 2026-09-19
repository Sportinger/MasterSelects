import { afterEach, describe, expect, it } from 'vitest';

import { resolveConnectedLiveInputSource } from '../../src/services/mediaRuntime/liveInputConnection';
import { liveInputRuntime, type ConnectedLiveInput } from '../../src/services/mediaRuntime/liveInputRuntime';

function connectedInput(label: string, deviceId?: string): ConnectedLiveInput {
  const video = document.createElement('video');
  Object.defineProperty(video, 'srcObject', {
    configurable: true,
    value: {
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    },
  });
  return { label, video };
}

describe('live input reconnect state', () => {
  afterEach(() => liveInputRuntime.clear());

  it('persists the concrete camera device returned by the browser', () => {
    expect(resolveConnectedLiveInputSource(
      { kind: 'video-device' },
      connectedInput('Studio Camera', 'camera-42'),
    )).toEqual({
      kind: 'video-device',
      deviceId: 'camera-42',
      deviceLabel: 'Studio Camera',
    });
  });

  it('keeps a display label as serializable metadata', () => {
    expect(resolveConnectedLiveInputSource(
      { kind: 'display' },
      connectedInput('Editing Screen'),
    )).toEqual({
      kind: 'display',
      displayLabel: 'Editing Screen',
    });
  });

  it('keeps project-load prompts separate from ordinary reconnect requirements', () => {
    liveInputRuntime.setReconnectRequiredIds(['camera-a', 'camera-b'], { showBulkPrompt: true });
    expect(liveInputRuntime.getBulkReconnectPromptIds()).toEqual(['camera-a', 'camera-b']);

    liveInputRuntime.setReconnectRequiredIds(['camera-b', 'camera-c']);
    expect(liveInputRuntime.getReconnectRequiredIds()).toEqual(['camera-b', 'camera-c']);
    expect(liveInputRuntime.getBulkReconnectPromptIds()).toEqual(['camera-b']);

    liveInputRuntime.dismissBulkReconnectPrompt();
    expect(liveInputRuntime.getBulkReconnectPromptIds()).toEqual([]);
    expect(liveInputRuntime.getReconnectRequiredIds()).toEqual(['camera-b', 'camera-c']);
  });
});
