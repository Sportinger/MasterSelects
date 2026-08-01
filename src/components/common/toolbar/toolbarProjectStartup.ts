import { isMotionDesignEvidenceSessionUrl } from '../../../services/motionDesign/evidence/motionDesignEvidenceSession';

export type ToolbarProjectBootRestoreResult = 'evidence-isolated' | 'restored' | 'not-restored';

export async function runToolbarProjectBootRestore(input: {
  url: string | URL;
  restoreLastProject: () => Promise<boolean>;
  loadProjectToStores: () => Promise<unknown>;
}): Promise<ToolbarProjectBootRestoreResult> {
  if (isMotionDesignEvidenceSessionUrl(input.url)) {
    return 'evidence-isolated';
  }

  const restored = await input.restoreLastProject();
  if (!restored) return 'not-restored';
  await input.loadProjectToStores();
  return 'restored';
}
