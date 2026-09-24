import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  IconArrowRight,
  IconFolderOpen,
  IconPlus,
} from '@tabler/icons-react';
import {
  RECENT_PROJECTS_CHANGED_EVENT,
  projectFileService,
  type RecentProjectEntry,
} from '../../services/projectFileService';
import {
  createBlankProject,
  loadProjectToStores,
  openExistingProject,
  openStoredProject,
} from '../../services/projectSync';
import { getProjectWriteSupportError, resolveProjectRootMode } from '../../services/project/core/projectRootAccess';
import { validateProjectName } from './projectNameValidation';
import './EditorProjectSelectionOverlay.css';

const OVERLAY_EXIT_DURATION_MS = 200;

interface EditorProjectSelectionOverlayProps {
  onProjectSelected: () => void;
}

function formatRecentDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Recently opened';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function EditorProjectSelectionOverlay({
  onProjectSelected,
}: EditorProjectSelectionOverlayProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => (
    projectFileService.getRecentProjects()
  ));
  const [isNamingProject, setIsNamingProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  // WebKit has no folder picker, so "open existing" becomes a list of the
  // projects already stored on this device. null means the list is not shown.
  const [storageMode] = useState(resolveProjectRootMode);
  const [storedProjects, setStoredProjects] = useState<string[] | null>(null);
  const completionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const refresh = () => setRecentProjects(projectFileService.getRecentProjects());
    window.addEventListener(RECENT_PROJECTS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_PROJECTS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => () => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
    }
  }, []);

  const completeSelection = useCallback(() => {
    setIsClosing(true);
    completionTimerRef.current = window.setTimeout(() => {
      onProjectSelected();
    }, OVERLAY_EXIT_DURATION_MS);
  }, [onProjectSelected]);

  const confirmProjectSwitch = useCallback(() => (
    !projectFileService.hasUnsavedChanges()
    || window.confirm('You have unsaved changes. Switch projects?')
  ), []);

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    const validationError = validateProjectName(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!confirmProjectSwitch()) return;

    setBusyAction('new');
    setError(null);
    try {
      const result = await createBlankProject(name);
      if (result === 'not-created') {
        // Only the picker backend can be cancelled; elsewhere this is a failure,
        // and telling the user to pick a folder would send them nowhere.
        setError(storageMode === 'fsa'
          ? 'No project folder was selected.'
          : getProjectWriteSupportError() ?? 'The project could not be created in this browser’s storage.');
        return;
      }
      if (result === 'save-failed') {
        setError('The project folder was created, but the .msproj package could not be saved.');
        return;
      }
      completeSelection();
    } catch {
      setError('The project could not be created.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenExisting = async () => {
    if (busyAction || !confirmProjectSwitch()) return;
    setBusyAction('existing');
    setError(null);
    try {
      if (storageMode !== 'fsa') {
        const names = await projectFileService.listStoredProjects();
        setStoredProjects(names);
        if (names.length === 0) {
          setError('No projects are stored on this device yet.');
        }
        return;
      }
      if (await openExistingProject()) {
        completeSelection();
      }
    } catch {
      setError('The project could not be opened.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenStored = async (name: string) => {
    if (busyAction || !confirmProjectSwitch()) return;
    setBusyAction(name);
    setError(null);
    try {
      if (await openStoredProject(name)) {
        completeSelection();
        return;
      }
      setError(`"${name}" could not be opened.`);
    } catch {
      setError('The project could not be opened.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenRecent = async (project: RecentProjectEntry) => {
    if (busyAction || !confirmProjectSwitch()) return;
    setBusyAction(project.id);
    setError(null);
    try {
      const opened = await projectFileService.openRecentProject(project.id);
      if (!opened) {
        setError('That project may have moved or needs permission again.');
        return;
      }
      await loadProjectToStores();
      completeSelection();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The project could not be opened.');
    } finally {
      setRecentProjects(projectFileService.getRecentProjects());
      setBusyAction(null);
    }
  };

  return (
    <div className={`editor-project-backdrop ${isClosing ? 'is-closing' : ''}`}>
      <section
        aria-labelledby="editor-project-heading"
        aria-modal="true"
        className="editor-project-dialog"
        role="dialog"
      >
        <div className="editor-project-body">
          <div className="editor-project-intro">
            <h1 id="editor-project-heading">Choose project</h1>
          </div>

          {isNamingProject ? (
            <form className="editor-project-name-form" onSubmit={handleCreateProject}>
              <div className="editor-project-name-heading">
                <div>
                  <strong>New project</strong>
                </div>
              </div>
              <label htmlFor="editor-project-name">Project name</label>
              <div className="editor-project-name-row">
                <input
                  autoFocus
                  disabled={busyAction !== null}
                  id="editor-project-name"
                  maxLength={120}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    setError(null);
                  }}
                  placeholder="Untitled edit"
                  value={projectName}
                />
                <button
                  className="editor-project-submit"
                  disabled={!projectName.trim() || busyAction !== null}
                  type="submit"
                >
                  {busyAction === 'new' ? 'Creating…' : 'Continue'}
                  <IconArrowRight aria-hidden="true" />
                </button>
              </div>
              <button
                className="editor-project-cancel"
                disabled={busyAction !== null}
                type="button"
                onClick={() => {
                  setIsNamingProject(false);
                  setProjectName('');
                  setError(null);
                }}
              >
                Cancel
              </button>
            </form>
          ) : storedProjects !== null ? (
            <div className="editor-project-grid">
              {storedProjects.map((name, index) => (
                <button
                  className="editor-project-box"
                  disabled={busyAction !== null}
                  key={name}
                  title={name}
                  type="button"
                  onClick={() => void handleOpenStored(name)}
                >
                  <span className="editor-project-box-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="editor-project-box-copy">
                    <strong>{name}</strong>
                    <small>{busyAction === name ? 'Opening…' : 'Stored on this device'}</small>
                  </span>
                  <IconArrowRight aria-hidden="true" />
                </button>
              ))}
              {storedProjects.length === 0 && (
                <div className="editor-project-empty">No stored projects</div>
              )}
              <button
                className="editor-project-cancel"
                disabled={busyAction !== null}
                type="button"
                onClick={() => {
                  setStoredProjects(null);
                  setError(null);
                }}
              >
                Back
              </button>
            </div>
          ) : (
            <div className="editor-project-grid">
              <button
                className="editor-project-box is-new"
                disabled={busyAction !== null}
                type="button"
                onClick={() => setIsNamingProject(true)}
              >
                <span className="editor-project-box-icon">
                  <IconPlus aria-hidden="true" />
                </span>
                <span className="editor-project-box-copy">
                  <strong>New project</strong>
                  <small>Empty timeline</small>
                </span>
                <IconArrowRight aria-hidden="true" />
              </button>
              <button
                className="editor-project-box is-existing"
                disabled={busyAction !== null}
                type="button"
                onClick={() => void handleOpenExisting()}
              >
                <span className="editor-project-box-icon">
                  <IconFolderOpen aria-hidden="true" />
                </span>
                <span className="editor-project-box-copy">
                  <strong>{busyAction === 'existing' ? 'Opening…' : 'Open existing'}</strong>
                  <small>{storageMode === 'fsa' ? 'Project folder' : 'Stored on this device'}</small>
                </span>
                <IconArrowRight aria-hidden="true" />
              </button>
              {recentProjects.map((project, index) => (
                <button
                  className="editor-project-box"
                  disabled={busyAction !== null}
                  key={project.id}
                  title={project.path || project.name}
                  type="button"
                  onClick={() => void handleOpenRecent(project)}
                >
                  <span className="editor-project-box-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="editor-project-box-copy">
                    <strong>{project.name}</strong>
                    <small>{busyAction === project.id ? 'Opening…' : formatRecentDate(project.lastOpenedAt)}</small>
                  </span>
                  <IconArrowRight aria-hidden="true" />
                </button>
              ))}
              {recentProjects.length === 0 && (
                <div className="editor-project-empty">No recent projects</div>
              )}
            </div>
          )}

          {error && <p className="editor-project-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
