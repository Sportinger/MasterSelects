// 'projects' sheet: rename the open project (Done = rename), see its canvas and save state, and go
// back to the project list. Going back saves, closes the project through the desktop close path and
// asks the phone UI to show its home screen. Full editor saves and opens the same project at /editor.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PHONE_M1_TEST_IDS, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { renamePhoneProject } from './usePhoneProjectCommands';
import { PhoneStorageStatus } from './PhoneStorageStatus';
import { saveAndOpenFullEditor } from './phoneFullEditor';
import { validateProjectName } from '../../common/projectNameValidation';
import { Logger } from '../../../services/logger';
import { projectFileService } from '../../../services/projectFileService';
import { closeCurrentProject, saveCurrentProject } from '../../../services/projectSync';
import { useMediaStore } from '../../../stores/mediaStore';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import './PhoneProject.css';

const log = Logger.create('PhoneProjectSheet');

// ---------------------------------------------------------------------------
// Home requests: a module-level listener set the home/assembly code subscribes to.
// ---------------------------------------------------------------------------

const homeListeners = new Set<() => void>();

/** Subscribe to "show the phone home screen" requests; returns the unsubscribe function. */
export function subscribePhoneHomeRequests(callback: () => void): () => void {
  homeListeners.add(callback);
  return () => {
    homeListeners.delete(callback);
  };
}

/** Ask the phone UI to show its home (project list) screen. */
export function requestPhoneHome(): void {
  if (homeListeners.size === 0) log.warn('Phone home requested, but no home screen is listening');
  for (const listener of [...homeListeners]) listener();
}

function useCompositionSummary(): string {
  const composition = useMediaStore((state) => state.compositions.find((comp) => comp.id === state.activeCompositionId));
  return composition
    ? `${composition.name} · ${composition.width}×${composition.height} · ${composition.frameRate} fps`
    : 'No composition';
}

export const PhoneProjectSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const currentName = useMemo(() => projectFileService.getProjectData()?.name ?? '', []);
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState<'rename' | 'close' | 'full-editor' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const compositionSummary = useCompositionSummary();
  const projectOpen = projectFileService.isProjectOpen();

  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  const trimmed = draft.trim();
  const validation = trimmed === currentName ? null : validateProjectName(trimmed);

  const commitRename = async () => {
    if (busy) return;
    if (!projectOpen) {
      closeSheet();
      return;
    }
    if (validation) {
      setError(validation);
      return;
    }
    if (trimmed === currentName) {
      closeSheet();
      return;
    }
    setBusy('rename');
    setError(null);
    const result = await renamePhoneProject(trimmed);
    if (!aliveRef.current) return;
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      showToast(result.message, 'error');
      return;
    }
    if (result.message) showToast(result.message);
    closeSheet();
  };

  const backToProjects = async () => {
    if (busy) return;
    setBusy('close');
    setError(null);
    try {
      // A read-only tab has nothing of its own to save.
      const writable = getActiveRepositorySession()?.opening.writable !== false;
      if (projectOpen && writable && !await saveCurrentProject({ source: 'manual' })) {
        const message = 'The project could not be saved, so it stays open. Check the save status and try again.';
        if (aliveRef.current) setError(message);
        showToast(message, 'error');
        return;
      }
      await closeCurrentProject();
      closeSheet();
      requestPhoneHome();
    } catch (failure) {
      log.error('Closing the project failed', failure);
      const message = `The project could not be closed. ${failure instanceof Error ? failure.message : String(failure)}`;
      if (aliveRef.current) setError(message);
      showToast(message, 'error');
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const openFullEditor = async () => {
    if (busy) return;
    setBusy('full-editor');
    setError(null);
    const result = await saveAndOpenFullEditor();
    if (result.ok) return;
    if (aliveRef.current) {
      setError(result.message);
      setBusy(null);
    }
    showToast(result.message, 'error');
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitRename();
  };

  return (
    <PhoneSheet
      title="Project"
      height="half"
      onCancel={closeSheet}
      onDone={() => void commitRename()}
      doneLabel={busy === 'rename' ? 'Renaming…' : 'Done'}
      doneDisabled={busy !== null || (projectOpen && validation !== null)}
    >
      <form className="phone-project-sheet" onSubmit={onSubmit}>
        <label className="phone-project-sheet__label" htmlFor="phone-project-name-input">Project name</label>
        <input
          id="phone-project-name-input"
          className="phone-project-sheet__input"
          data-testid={PHONE_M1_TEST_IDS.projectNameInput}
          value={draft}
          disabled={!projectOpen || busy !== null}
          maxLength={120}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={validation !== null}
          aria-describedby="phone-project-sheet-error"
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
        />
        <p id="phone-project-sheet-error" className="phone-project-sheet__error" role="alert">
          {error ?? validation ?? ''}
        </p>
        <div className="phone-project-sheet__row">
          <span className="phone-project-sheet__meta">{compositionSummary}</span>
          <PhoneStorageStatus />
        </div>
        <button
          type="button"
          className="phone-project-sheet__button"
          aria-disabled={busy !== null}
          onClick={() => void backToProjects()}
        >
          {busy === 'close' ? 'Saving and closing…' : 'Back to projects'}
        </button>
        <button
          type="button"
          className="phone-project-sheet__button"
          aria-disabled={busy !== null}
          data-testid={PHONE_M1_TEST_IDS.fullEditor}
          onClick={() => void openFullEditor()}
        >
          {busy === 'full-editor' ? 'Saving and opening…' : 'Full editor · all tools'}
        </button>
      </form>
    </PhoneSheet>
  );
};
