import { afterEach, describe, expect, it } from 'vitest';
import { linkedMediaSourceRuntime } from '../../src/services/mediaRuntime/linkedMediaSourceRuntime';
import type { MediaFile, MediaState } from '../../src/stores/mediaStore';
import { createProxySlice, type ProxyActions } from '../../src/stores/mediaStore/slices/proxySlice';

function createMedia(sourceSelection: MediaFile['sourceSelection'] = { mode: 'auto' }): MediaFile {
  return {
    id: 'original-braw',
    name: 'A006_08111727_C002.braw',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: 'blob:proxy',
    file: new File(['proxy'], 'A006_08111727_C002_Proxy.mov', { type: 'video/quicktime' }),
    proxyStatus: 'none',
    linkedSources: [{
      id: 'premiere-proxy',
      name: 'A006_08111727_C002_Proxy.mov',
      role: 'proxy',
      origin: 'premiere',
    }],
    sourceSelection,
  } as MediaFile;
}

describe('external proxy generation guard', () => {
  function createProxyActions(files: MediaFile[]) {
    let state = {
      files,
      currentlyGeneratingProxyId: null,
    } as unknown as MediaState;
    const set = (partial: Partial<MediaState> | ((current: MediaState) => Partial<MediaState>)) => {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
    };
    const actions: ProxyActions = createProxySlice(set, () => ({ ...state, ...actions }));
    return {
      actions,
      getState: () => ({ ...state, ...actions }),
    };
  }

  afterEach(() => {
    linkedMediaSourceRuntime.clear();
  });

  it('does not queue an active Premiere proxy for another MS proxy transcode', () => {
    const media = createMedia();
    linkedMediaSourceRuntime.setActive(media.id, { kind: 'linked', sourceId: 'premiere-proxy' });
    const { actions } = createProxyActions([media]);

    expect(actions.getNextFileNeedingProxy()).toBeUndefined();
  });

  it('also blocks a direct proxy command for an explicitly selected Premiere proxy', async () => {
    const media = createMedia({ mode: 'linked', sourceId: 'premiere-proxy' });
    const { actions, getState } = createProxyActions([media]);

    await actions.generateProxy(media.id, { force: true });

    expect(getState().currentlyGeneratingProxyId).toBeNull();
    expect(getState().files[0]?.proxyStatus).toBe('none');
  });

  it('still allows proxy generation when the original source is active', () => {
    const media = createMedia({ mode: 'original' });
    linkedMediaSourceRuntime.setActive(media.id, { kind: 'original' });
    const { actions } = createProxyActions([media]);

    expect(actions.getNextFileNeedingProxy()?.id).toBe(media.id);
  });
});
