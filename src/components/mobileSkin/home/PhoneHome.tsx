// Phone home screen: start a project (name + canvas format), reopen a stored one, import a .msproj.
// Everything goes through usePhoneProjectCommands(); a failed command is shown, never swallowed.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PHONE_M1_TEST_IDS,
  PHONE_PROJECT_FORMATS,
  type PhoneActionResult,
  type PhoneProjectFormatId,
} from '../contracts';
import { validateProjectName } from '../../common/projectNameValidation';
import { Logger } from '../../../services/logger';
import { usePhoneProjectCommands, type PhoneStoredProject } from '../project/usePhoneProjectCommands';
import { usePhoneProjectSelection } from '../runtime/PhoneRuntimeContext';
import { PhoneIcon } from '../shell/phoneIcons';
import './PhoneHome.css';

const log = Logger.create('PhoneHome');
const FORMAT_IDS = Object.keys(PHONE_PROJECT_FORMATS) as PhoneProjectFormatId[];
const DEFAULT_FORMAT: PhoneProjectFormatId = '9:16';

export interface PhoneHomeProps {
  /** Called after a project was created, opened or imported, and by "Back to editing". */
  onClose?: () => void;
  /** A project is already open: offer "Back to editing". */
  showBack?: boolean;
}

function formatLastOpened(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return 'Stored on this device';
  return `Opened ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))}`;
}

/** Most recent first; projects never opened here (no timestamp) sort last, by name. */
export function sortPhoneProjects(projects: readonly PhoneStoredProject[]): PhoneStoredProject[] {
  return projects.toSorted((a, b) => (b.lastOpened ?? -1) - (a.lastOpened ?? -1) || a.name.localeCompare(b.name));
}

function FormatGlyph({ format }: { format: PhoneProjectFormatId }) {
  const { width, height } = PHONE_PROJECT_FORMATS[format];
  const scale = 22 / Math.max(width, height);
  return (
    <span
      className="phone-home__format-glyph"
      style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      aria-hidden="true"
    />
  );
}

export function PhoneHome({ onClose, showBack = false }: PhoneHomeProps = {}) {
  const commands = usePhoneProjectCommands();
  const { markProjectSelected } = usePhoneProjectSelection();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<PhoneProjectFormatId>(DEFAULT_FORMAT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { refresh } = commands;

  useEffect(() => {
    refresh().catch((refreshError: unknown) => {
      log.error('Project list refresh failed', refreshError);
      setError(`The project list could not be loaded: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
    });
  }, [refresh]);

  useEffect(() => {
    if (creating) nameInputRef.current?.focus({ preventScroll: true });
  }, [creating]);

  const run = async (label: string, action: () => Promise<PhoneActionResult>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      markProjectSelected();
      onClose?.();
    } catch (actionError) {
      log.error(`${label} failed`, actionError);
      setError(`${label} failed: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      setBusy(null);
    }
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    const invalid = validateProjectName(trimmed);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run('Creating the project', () => commands.createProject(trimmed, format));
  };

  const projects = sortPhoneProjects(commands.projects);

  return (
    <main className="phone-home" data-testid={PHONE_M1_TEST_IDS.home} aria-label="Projects">
      <div className="phone-home__inner">
        <header className="phone-home__head">
          <div>
            <h1 className="phone-home__title">MasterSelects</h1>
            <p className="phone-home__subtitle">Your projects, ready to continue</p>
          </div>
          {showBack && onClose ? (
            <button type="button" className="phone-home__back" aria-label="Back to editing" onClick={onClose}>
              <PhoneIcon name="close" size={22} />
            </button>
          ) : null}
        </header>

        {error ? <p className="phone-home__error" role="alert">{error}</p> : null}
        {note ? <p className="phone-home__note" role="status">{note}</p> : null}

        <section className="phone-home__card" aria-label="New project">
          {creating ? (
            <form className="phone-home__form" onSubmit={submitCreate} noValidate>
              <label className="phone-home__label" htmlFor="phone-home-name">Project name</label>
              <input
                id="phone-home-name"
                ref={nameInputRef}
                className="phone-home__input"
                data-testid={PHONE_M1_TEST_IDS.projectNameInput}
                value={name}
                placeholder="My project"
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint="done"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="phone-home__label" id="phone-home-canvas">Choose your canvas</div>
              <div className="phone-home__formats" role="radiogroup" aria-labelledby="phone-home-canvas">
                {FORMAT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={format === id}
                    className="phone-home__format"
                    data-format={id}
                    data-testid={`${PHONE_M1_TEST_IDS.formatChip}-${id}`}
                    onClick={() => setFormat(id)}
                  >
                    <FormatGlyph format={id} />
                    <span>{id}</span>
                  </button>
                ))}
              </div>
              <div className="phone-home__form-actions">
                <button
                  type="button"
                  className="phone-home__button"
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="phone-home__button phone-home__button--primary"
                  aria-disabled={busy !== null}
                  data-testid={PHONE_M1_TEST_IDS.createProject}
                >
                  {busy === 'Creating the project' ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="phone-home__new"
              data-testid={PHONE_M1_TEST_IDS.newProject}
              onClick={() => setCreating(true)}
            >
              <PhoneIcon name="plus" size={26} />
              <span>New project</span>
            </button>
          )}
        </section>

        <section aria-label="Recent projects">
          <h2 className="phone-home__section">Recent projects</h2>
          {projects.length === 0 ? (
            <p className="phone-home__empty">No projects on this device yet. Create one above.</p>
          ) : (
            <ul className="phone-home__list">
              {projects.map((project) => (
                <li key={project.name}>
                  <button
                    type="button"
                    className="phone-home__row"
                    aria-disabled={busy !== null}
                    data-testid={PHONE_M1_TEST_IDS.projectRow}
                    data-project-name={project.name}
                    onClick={() => void run(`Opening ${project.name}`, () => commands.openProject(project.name))}
                  >
                    <span className="phone-home__row-name">{project.name}</span>
                    <span className="phone-home__row-meta">
                      {formatLastOpened(project.lastOpened)}
                      {project.location ? ` · ${project.location}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          type="button"
          className="phone-home__wide"
          aria-disabled="true"
          onClick={() => setNote('Templates and Looks arrive with milestone M3 of the phone editor.')}
        >
          <span className="phone-home__wide-title">Templates / Looks</span>
          <span className="phone-home__wide-meta">Arrives with M3</span>
        </button>
        <button
          type="button"
          className="phone-home__wide"
          aria-disabled="true"
          onClick={() => setNote('The assistant arrives with milestone M5 of the phone editor.')}
        >
          <span className="phone-home__wide-title">Assistant</span>
          <span className="phone-home__wide-meta">Arrives with M5</span>
        </button>

        <button
          type="button"
          className="phone-home__wide phone-home__wide--import"
          aria-disabled={busy !== null}
          data-testid={PHONE_M1_TEST_IDS.importArchive}
          onClick={() => {
            if (!busy) fileInputRef.current?.click();
          }}
        >
          {busy === 'Importing the project' ? 'Importing…' : 'Import project file · .msproj'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".msproj"
          hidden
          data-testid={`${PHONE_M1_TEST_IDS.importArchive}-input`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void run('Importing the project', () => commands.importArchive(file));
          }}
        />
      </div>
    </main>
  );
}
