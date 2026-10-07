import { execFileSync } from 'node:child_process';

export interface BuildIdentity {
  schema: 'masterselects-build/v1';
  version: string;
  buildId: string;
  sourceRevision: string | null;
  sourceDirty: boolean;
  releaseId: string | null;
}

export function buildIdentity({ version, development, cwd, now = new Date(),
  env = process.env, git = (args: string[]) => execFileSync('git', args,
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
}: { version: string; development: boolean; cwd: string; now?: Date;
  env?: NodeJS.ProcessEnv; git?: (args: string[]) => string }): BuildIdentity {
  const commit = /^[a-f0-9]{40}$/;
  const supplied = env.CF_PAGES_COMMIT_SHA;
  let sourceRevision: string | null = null, sourceDirty = true;
  try {
    const head = git(['rev-parse', 'HEAD']);
    if (commit.test(head)) sourceRevision = head;
    sourceDirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;
  } catch { /* Source archives may have only the build provider's commit. */ }
  if (supplied) {
    if (!commit.test(supplied) || (sourceRevision && sourceRevision !== supplied)) {
      throw new Error('Build provider commit does not match the source checkout.');
    }
    // Without a Git checkout, dirty state cannot be independently established.
    sourceRevision ??= supplied;
  }
  const releaseId = sourceRevision && !sourceDirty && !development
    ? `masterselects-${version}-${sourceRevision}` : null;
  return { schema: 'masterselects-build/v1', version,
    buildId: development ? 'development' : now.toISOString(), sourceRevision, sourceDirty, releaseId };
}
