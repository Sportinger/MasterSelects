export type ProjectSaveIdentity = object | string;
export interface ProjectSaveStatus {
  saving: boolean;
  failed: boolean;
  lastSuccessfulSave: number | null;
}
const emptyStatus: ProjectSaveStatus = { saving: false, failed: false, lastSuccessfulSave: null };

class SaveStatusRegistry {
  private handles = new WeakMap<object, ProjectSaveStatus>();
  private paths = new Map<string, ProjectSaveStatus>();
  read(identity: ProjectSaveIdentity | null): ProjectSaveStatus {
    if (!identity) return emptyStatus;
    return (typeof identity === 'string' ? this.paths.get(identity) : this.handles.get(identity)) ?? emptyStatus;
  }
  write(identity: ProjectSaveIdentity, state: ProjectSaveStatus): void {
    if (typeof identity === 'string') {
      this.paths.delete(identity);
      this.paths.set(identity, state);
      if (this.paths.size > 100) this.paths.delete(this.paths.keys().next().value!);
    } else this.handles.set(identity, state);
  }
  reset(identity: ProjectSaveIdentity | null): void {
    if (typeof identity === 'string') this.paths.delete(identity);
    else if (identity) this.handles.delete(identity);
  }
}

// Runtime state belongs to the active file handle/path, never to project data.
export const projectSaveStatus = (import.meta.hot?.data?.projectSaveStatus as SaveStatusRegistry | undefined)
  ?? new SaveStatusRegistry();
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.projectSaveStatus = projectSaveStatus; });
  import.meta.hot.accept();
}

export function reportProjectSaveFailure(identity: ProjectSaveIdentity | null): void {
  if (identity) projectSaveStatus.write(identity, { ...projectSaveStatus.read(identity), failed: true });
}

export async function trackProjectSave(identity: ProjectSaveIdentity | null, save: () => Promise<boolean>): Promise<boolean> {
  if (!identity) return save();
  const previous = projectSaveStatus.read(identity);
  projectSaveStatus.write(identity, { ...previous, saving: true, failed: false });
  let saved = false;
  try {
    saved = await save();
    return saved;
  } finally {
    projectSaveStatus.write(identity, {
      saving: false, failed: !saved,
      lastSuccessfulSave: saved ? Date.now() : previous.lastSuccessfulSave,
    });
  }
}
