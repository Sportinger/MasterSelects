import { isMotionDesignEvidenceSessionUrl } from '../../../services/motionDesign/evidence/motionDesignEvidenceSession';
import { resolveEntryExperience } from '../../../routing/entryExperience';

export type ToolbarProjectBootRestoreResult =
  | 'evidence-isolated'
  | 'selection-deferred'
  | 'restored'
  | 'not-restored';

export async function runToolbarProjectBootRestore(input: {
  url: string | URL;
  restoreLastProject: () => Promise<boolean>;
  loadProjectToStores: () => Promise<unknown>;
}): Promise<ToolbarProjectBootRestoreResult> {
  if (isMotionDesignEvidenceSessionUrl(input.url)) {
    return 'evidence-isolated';
  }

  const experience = resolveEntryExperience(new URL(input.url));
  if (experience === 'landing') {
    return 'selection-deferred';
  }

  const restored = await input.restoreLastProject();
  if (!restored) return 'not-restored';
  await input.loadProjectToStores();
  return 'restored';
}
