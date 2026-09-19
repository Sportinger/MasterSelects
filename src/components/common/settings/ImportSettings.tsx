import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import {
  connectCurrentProjectMediaSourceFiles,
  connectCurrentProjectMediaSourceRoot,
} from '../../../services/project/mediaSourceRootConnection';
import { useSettingsStore } from '../../../stores/settingsStore';

type SourceFolderPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: object) => Promise<FileSystemDirectoryHandle>;
};

export function ImportSettings() {
  const { copyMediaToProject, setCopyMediaToProject } = useSettingsStore();
  const [sourceFolderStatus, setSourceFolderStatus] = useState<string>('');
  const [connectingSourceFolder, setConnectingSourceFolder] = useState(false);
  const sourceFolderInputRef = useRef<HTMLInputElement>(null);
  const hasDirectoryPicker = typeof window !== 'undefined'
    && typeof (window as SourceFolderPickerWindow).showDirectoryPicker === 'function';
  const canConnectSourceFolder = projectFileService.isProjectOpen()
    && projectFileService.activeBackend !== 'native';

  useEffect(() => {
    sourceFolderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const setConnectedStatus = (result: {
    linkedMediaCount: number;
    rootName: string;
  }) => {
    setSourceFolderStatus(
      result.linkedMediaCount > 0
        ? `${result.rootName} connected · ${result.linkedMediaCount} existing media item${result.linkedMediaCount === 1 ? '' : 's'} indexed`
        : `${result.rootName} connected · future relinks keep their relative paths`,
    );
  };

  const connectSourceFolder = async () => {
    const picker = (window as SourceFolderPickerWindow).showDirectoryPicker;
    if (!picker) {
      const input = sourceFolderInputRef.current;
      if (!input) return;
      input.value = '';
      input.click();
      return;
    }
    setConnectingSourceFolder(true);
    setSourceFolderStatus('');
    try {
      const handle = await picker({ mode: 'read', startIn: 'videos' });
      const result = await connectCurrentProjectMediaSourceRoot(handle);
      setConnectedStatus(result);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSourceFolderStatus('Could not connect the selected source folder.');
      }
    } finally {
      setConnectingSourceFolder(false);
    }
  };

  const handleSourceFolderFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;

    setConnectingSourceFolder(true);
    setSourceFolderStatus('');
    try {
      const result = connectCurrentProjectMediaSourceFiles(files);
      if (result) {
        setConnectedStatus(result);
      } else {
        setSourceFolderStatus('No folder paths were provided. On iPhone/iPad, use iOS or iPadOS 18.4 or newer and select a folder in Files.');
      }
    } catch {
      setSourceFolderStatus('Could not connect the selected source folder.');
    } finally {
      setConnectingSourceFolder(false);
    }
  };

  return (
    <div className="settings-category-content">
      <input
        ref={sourceFolderInputRef}
        type="file"
        multiple
        onChange={handleSourceFolderFiles}
        aria-label="Select external source folder"
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -10000, top: 0 }}
      />
      <h2>Import</h2>

      <div className="settings-group">
        <div className="settings-group-title">Media Import</div>

        <label className="settings-row">
          <span className="settings-label">Copy media to project folder</span>
          <input
            type="checkbox"
            checked={copyMediaToProject}
            onChange={(e) => setCopyMediaToProject(e.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          When importing clips, copy them to the project's Raw folder for easier relinking.
        </p>

        <div className="settings-row">
          <span className="settings-label">External source folders</span>
          <button
            className="settings-button"
            type="button"
            disabled={!canConnectSourceFolder || connectingSourceFolder}
            onClick={() => void connectSourceFolder()}
            onPointerUp={(event) => event.currentTarget.blur()}
          >
            {connectingSourceFolder ? 'Connecting...' : 'Connect source folder...'}
          </button>
        </div>
        <p className="settings-hint">
          Saves relative media paths in the project. Android and desktop browsers can retain folder access; iPhone and iPad reconnect through the Files app.
          {!hasDirectoryPicker && ' Select the same folder again after Safari storage or permissions are cleared.'}
        </p>
        {sourceFolderStatus && <p className="settings-hint">{sourceFolderStatus}</p>}
      </div>
    </div>
  );
}
