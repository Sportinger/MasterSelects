import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNativeMediaInputAccept,
  positionNativeMediaInputAtAnchor,
  shouldUseNativeMediaInput,
  useMediaPanelAddImportCommands,
} from '../../src/components/panels/media/panel/useMediaPanelAddImportCommands';
import { productAnalytics } from '../../src/services/productAnalytics';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  Reflect.deleteProperty(window, 'matchMedia');
  window.history.replaceState(null, '', '/');
});

describe('MediaPanel native import picker', () => {
  it('prefers the native input on iPadOS even when picker APIs appear supported', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

    expect(shouldUseNativeMediaInput(true)).toBe(true);
    expect(getNativeMediaInputAccept()).toBe('image/*,video/*');
  });

  it('prefers the native input on Android even when picker APIs appear supported', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 16; Pixel Tablet) AppleWebKit');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });

    expect(shouldUseNativeMediaInput(true)).toBe(true);
    expect(getNativeMediaInputAccept()).toContain('audio/*');
  });

  it('prefers the native input on other coarse-pointer tablets', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    expect(shouldUseNativeMediaInput(true)).toBe(true);
  });

  it('opens the fallback input synchronously from the import command', () => {
    const input = document.createElement('input');
    input.type = 'file';
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    const importFilesWithPicker = vi.fn(async () => []);
    const noop = vi.fn();
    const { result } = renderHook(() => useMediaPanelAddImportCommands({
      fileInputRef: { current: input },
      fileSystemSupported: false,
      contextMenu: null,
      viewMode: 'list',
      gridFolderId: null,
      selectedIds: [],
      folders: [],
      compositionCount: 0,
      importFiles: vi.fn(async () => []),
      importFilesWithPicker,
      createComposition: noop,
      openCompositionTab: noop,
      createFolder: noop,
      createTextItem: noop,
      getOrCreateTextFolder: noop,
      createSolidItem: noop,
      getOrCreateSolidFolder: noop,
      createMeshItem: noop,
      getOrCreateMeshFolder: noop,
      createCameraItem: noop,
      getOrCreateCameraFolder: noop,
      createLightItem: noop,
      getOrCreateLightFolder: noop,
      createSplatEffectorItem: noop,
      getOrCreateSplatEffectorFolder: noop,
      createMathSceneItem: noop,
      getOrCreateMathSceneFolder: noop,
      createMotionShapeItem: noop,
      getOrCreateMotionShapeFolder: noop,
      importGaussianSplat: noop,
      closeContextMenu: noop,
    } as unknown as Parameters<typeof useMediaPanelAddImportCommands>[0]));

    act(() => result.current.handleImport({ x: 123, y: 321 }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(input.accept).toContain('video/*');
    expect(input.style.left).toBe('123px');
    expect(input.style.top).toBe('321px');
    expect(importFilesWithPicker).not.toHaveBeenCalled();
  });

  it('clamps the native picker anchor inside the visible viewport', () => {
    const input = document.createElement('input');

    positionNativeMediaInputAtAnchor(input, { x: -50, y: window.innerHeight + 50 });

    expect(input.style.left).toBe('0px');
    expect(input.style.top).toBe(`${window.innerHeight - 1}px`);
  });

  it('releases the native input before waiting for media processing', async () => {
    let finishImport: (value: []) => void = () => undefined;
    const importFiles = vi.fn(() => new Promise<[]>((resolve) => {
      finishImport = resolve;
    }));
    const noop = vi.fn();
    const { result } = renderHook(() => useMediaPanelAddImportCommands({
      fileInputRef: { current: null },
      fileSystemSupported: false,
      contextMenu: null,
      viewMode: 'list',
      gridFolderId: null,
      selectedIds: [],
      folders: [],
      compositionCount: 0,
      importFiles,
      importFilesWithPicker: noop,
      openNewCompositionSettings: noop,
      createFolder: noop,
      createTextItem: noop,
      getOrCreateTextFolder: noop,
      createSolidItem: noop,
      getOrCreateSolidFolder: noop,
      createMeshItem: noop,
      getOrCreateMeshFolder: noop,
      createCameraItem: noop,
      getOrCreateCameraFolder: noop,
      createLightItem: noop,
      getOrCreateLightFolder: noop,
      createSplatEffectorItem: noop,
      getOrCreateSplatEffectorFolder: noop,
      createMathSceneItem: noop,
      getOrCreateMathSceneFolder: noop,
      createMotionShapeItem: noop,
      getOrCreateMotionShapeFolder: noop,
      importGaussianSplat: noop,
      closeContextMenu: noop,
    } as unknown as Parameters<typeof useMediaPanelAddImportCommands>[0]));
    const file = new File(['video'], 'ipad-video.mov', { type: 'video/quicktime' });
    const input = { files: [file], value: 'selected' } as unknown as HTMLInputElement;

    const pendingImport = result.current.handleFileChange({
      currentTarget: input,
      target: input,
    } as ChangeEvent<HTMLInputElement>);

    expect(input.value).toBe('');
    expect(importFiles).toHaveBeenCalledWith([file]);
    finishImport([]);
    await pendingImport;
  });

  it('records creation of a text media item inside the editor', () => {
    window.history.replaceState(null, '', '/editor');
    const trackSpy = vi.spyOn(productAnalytics, 'track').mockImplementation(() => undefined);
    const createTextItem = vi.fn(() => 'text-item-1');
    const closeContextMenu = vi.fn();
    const noop = vi.fn();
    const { result } = renderHook(() => useMediaPanelAddImportCommands({
      fileInputRef: { current: null },
      fileSystemSupported: false,
      contextMenu: null,
      viewMode: 'list',
      gridFolderId: null,
      selectedIds: [],
      folders: [],
      compositionCount: 0,
      importFiles: noop,
      importFilesWithPicker: noop,
      openNewCompositionSettings: noop,
      createFolder: noop,
      createTextItem,
      getOrCreateTextFolder: vi.fn(() => 'text-folder-1'),
      createSolidItem: noop,
      getOrCreateSolidFolder: noop,
      createMeshItem: noop,
      getOrCreateMeshFolder: noop,
      createCameraItem: noop,
      getOrCreateCameraFolder: noop,
      createLightItem: noop,
      getOrCreateLightFolder: noop,
      createSplatEffectorItem: noop,
      getOrCreateSplatEffectorFolder: noop,
      createMathSceneItem: noop,
      getOrCreateMathSceneFolder: noop,
      createMotionShapeItem: noop,
      getOrCreateMotionShapeFolder: noop,
      importGaussianSplat: noop,
      closeContextMenu,
    } as unknown as Parameters<typeof useMediaPanelAddImportCommands>[0]));

    act(() => result.current.handleNewText());

    expect(createTextItem).toHaveBeenCalledWith(undefined, 'text-folder-1');
    expect(trackSpy).toHaveBeenCalledWith('editor_control_committed', {
      area: 'text',
      control_id: 'create-text-item',
      control_kind: 'button',
      input_method: 'click',
      interaction: 'add',
      item_id: 'text-item',
      item_kind: 'other',
    });
    expect(closeContextMenu).toHaveBeenCalledOnce();
  });
});
