import { useEffect, useState } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { useDockStore } from '../../stores/dockStore';
import { Logger } from '../../services/logger';
import { importProjectDrop } from '../panels/media/importProjectDrop';
import './EditorFileDrop.css';

const log = Logger.create('EditorFileDrop');

function isExternalFileDrag(transfer: DataTransfer | null): transfer is DataTransfer {
  const types = Array.from(transfer?.types ?? []);
  return types.includes('Files') && !types.some(type =>
    type.startsWith('application/x-media-') || type.startsWith('application/x-masterselects-')
    || type.startsWith('application/x-ms-'));
}

function isTimeline(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-panel-type="timeline"]');
}

/** OS files dropped outside the timeline/media folders always enter the media library. */
export function EditorFileDrop() {
  const [destination, setDestination] = useState<'media' | 'timeline' | null>(null);
  useEffect(() => {
    const clear = () => setDestination(null);
    const over = (event: DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) { clear(); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDestination(isTimeline(event.target) ? 'timeline' : 'media');
    };
    const drop = (event: DragEvent) => {
      clear();
      if (!isExternalFileDrag(event.dataTransfer)) return;
      event.preventDefault(); // Never navigate the browser to a dropped file.
      // Keep timeline placement and media-folder targeting with their existing handlers.
      if (isTimeline(event.target) || (event.target instanceof Element && event.target.closest('.media-panel'))) return;
      event.stopPropagation();
      const media = useMediaStore.getState();
      // Start collecting before the DataTransfer becomes inaccessible after event dispatch.
      void importProjectDrop(event.dataTransfer, null, {
        createFolder: media.createFolder, existingFolders: media.folders,
        importFiles: media.importFiles, importFilesWithHandles: media.importFilesWithHandles,
      }).catch(error => {
        log.warn('File drop import failed', error);
        window.alert(`Could not import files: ${error instanceof Error ? error.message : 'Unknown error'}`);
      });
      useDockStore.getState().activatePanelType('media');
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)) clear();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    document.addEventListener('dragenter', over, true);
    document.addEventListener('dragover', over, true);
    document.addEventListener('drop', drop, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('dragend', clear, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('dragenter', over, true);
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('drop', drop, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('dragend', clear, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return destination && <div className="editor-file-drop-overlay" role="status" aria-live="polite">
    <div className="editor-file-drop-message">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="72" height="72" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12" />
      </svg>
      <strong>{destination === 'timeline' ? 'Drop to add to Timeline' : 'Drop files or folders to Media'}</strong>
      <span>{destination === 'timeline' ? 'Place clips at the highlighted position' : 'Anywhere in the editor · Drop on the Timeline to place clips directly'}</span>
    </div>
  </div>;
}
