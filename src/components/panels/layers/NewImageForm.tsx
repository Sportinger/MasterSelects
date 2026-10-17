import { useRef, useState } from 'react';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { Logger } from '../../../services/logger';
import {
  createImageDocument,
  openMediaFileAsImageDocument,
  type ImageDocumentBackground,
} from '../../../services/imageDocument/imageDocumentService';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore';

const log = Logger.create('LayersPanel');

const SIZE_PRESETS = [
  { value: '1920x1080', label: 'Full HD 1920 × 1080' },
  { value: '3840x2160', label: '4K UHD 3840 × 2160' },
  { value: '1080x1080', label: 'Square 1080 × 1080' },
  { value: '1080x1350', label: 'Portrait 4:5 1080 × 1350' },
  { value: '1080x1920', label: 'Story 1080 × 1920' },
  { value: '1280x720', label: 'Thumbnail 1280 × 720' },
  { value: '2480x3508', label: 'A4 300 dpi 2480 × 3508' },
  { value: 'custom', label: 'Custom' },
] as const;

const BACKGROUNDS: { value: ImageDocumentBackground; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'transparent', label: 'Transparent' },
];

interface NewImageFormProps {
  canUseCurrentFrame: boolean;
  onCurrentFrame: () => void;
  onCreated: () => void;
}

export function NewImageForm({ canUseCurrentFrame, onCurrentFrame, onCreated }: NewImageFormProps) {
  const [preset, setPreset] = useState<string>('1920x1080');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [background, setBackground] = useState<ImageDocumentBackground>('white');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const choosePreset = (value: string) => {
    setPreset(value);
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (match) {
      setWidth(Number(match[1]));
      setHeight(Number(match[2]));
    }
  };
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      onCreated();
    } catch (error) {
      log.warn('Image document action failed', error);
    } finally {
      setBusy(false);
    }
  };
  const openFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void run(async () => {
      const imported = await useMediaStore.getState().importFile(file);
      if (imported.type !== 'image' && imported.type !== 'video') {
        log.warn('Opened file is not an image', { name: file.name, type: imported.type });
        return;
      }
      await openMediaFileAsImageDocument(imported as MediaFile);
    });
  };

  return (
    <div className="layers-start">
      <h3>New image</h3>
      <label className="layers-field">
        <span>Size</span>
        <InspectorSelect ariaLabel="Image size preset" onChange={choosePreset} options={[...SIZE_PRESETS]} value={preset} />
      </label>
      <div className="layers-field-pair">
        <label className="layers-field">
          <span>W</span>
          <input
            aria-label="Image width"
            min={1}
            max={16384}
            onChange={(event) => { setPreset('custom'); setWidth(Number(event.target.value)); }}
            type="number"
            value={width}
          />
        </label>
        <label className="layers-field">
          <span>H</span>
          <input
            aria-label="Image height"
            min={1}
            max={16384}
            onChange={(event) => { setPreset('custom'); setHeight(Number(event.target.value)); }}
            type="number"
            value={height}
          />
        </label>
      </div>
      <label className="layers-field">
        <span>Background</span>
        <InspectorSelect ariaLabel="Image background" onChange={setBackground} options={BACKGROUNDS} value={background} />
      </label>
      <button
        className="layers-primary-button"
        disabled={busy || !(width > 0 && height > 0)}
        onClick={() => { void run(() => createImageDocument({ width, height, background })); }}
        type="button"
      >
        Create image
      </button>
      <div className="layers-start-divider" />
      <button disabled={busy} onClick={() => fileInput.current?.click()} type="button">Open image file…</button>
      <button
        disabled={busy || !canUseCurrentFrame}
        onClick={onCurrentFrame}
        title={canUseCurrentFrame ? 'Render the current frame into a new image' : 'Open a composition first'}
        type="button"
      >
        Image from current frame
      </button>
      <p className="layers-hint">Tip: right-click a photo in Media and choose “Edit as Image”.</p>
      <input
        accept="image/*"
        hidden
        onChange={(event) => { openFiles(event.target.files); event.target.value = ''; }}
        ref={fileInput}
        type="file"
      />
    </div>
  );
}
