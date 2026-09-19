import { afterEach, describe, expect, it, vi } from 'vitest';

type PickerType = {
  description: string;
  accept: Record<string, string[]>;
};

type PickerOptions = {
  multiple?: boolean;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
};

const originalOpenPicker = Object.getOwnPropertyDescriptor(window, 'showOpenFilePicker');
const originalDirectoryPicker = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');

function restoreWindowProperty(property: 'showOpenFilePicker' | 'showDirectoryPicker', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, property, descriptor);
    return;
  }

  Reflect.deleteProperty(window, property);
}

describe('fileSystemService picker surface', () => {
  it('ignores duplicate open requests and allows a new picker after cancellation', async () => {
    let rejectPicker!: (error: Error) => void;
    const showOpenFilePicker = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPicker = reject; }))
      .mockResolvedValue([]);
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: showOpenFilePicker });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn() });
    const { pickFiles } = await vi.importActual<typeof import('../../src/services/fileSystemService')>('../../src/services/fileSystemService');
    const first = pickFiles();
    await expect(pickFiles()).resolves.toBeNull();
    expect(showOpenFilePicker).toHaveBeenCalledTimes(1);
    rejectPicker(new DOMException('Cancelled', 'AbortError'));
    await expect(first).resolves.toBeNull();
    await expect(pickFiles()).resolves.toEqual([]);
    expect(showOpenFilePicker).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    restoreWindowProperty('showOpenFilePicker', originalOpenPicker);
    restoreWindowProperty('showDirectoryPicker', originalDirectoryPicker);
    vi.resetModules();
  });

  it('keeps media filters first and exposes the all-files picker option', async () => {
    const file = new File(['{"ok":true}'], 'manifest.json', {
      type: 'application/json',
      lastModified: 1,
    });
    const handle = {
      kind: 'file',
      name: file.name,
      getFile: vi.fn(async () => file),
    } as unknown as FileSystemFileHandle;
    const showOpenFilePicker = vi.fn(async () => [handle]);

    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: showOpenFilePicker,
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(),
    });

    const { pickFiles } = await vi.importActual<typeof import('../../src/services/fileSystemService')>(
      '../../src/services/fileSystemService',
    );

    const result = await pickFiles();

    expect(result).toEqual([{ file, handle }]);
    const options = showOpenFilePicker.mock.calls[0]?.[0] as PickerOptions | undefined;
    expect(options?.multiple).toBe(true);
    expect(options?.excludeAcceptAllOption).toBe(false);
    expect(options?.types?.map((type) => type.description)).toEqual(['Media Files']);
    expect(options?.types?.[0]?.accept).toEqual({
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
      'audio/*': ['.mp3', '.wav', '.ogg', '.aac', '.m4a'],
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
      'application/octet-stream': ['.prproj'],
    });
  });
});
