import path from 'node:path';

// Folders the editor, its ?test= routes and the tests/browser pages never
// import. Watching them costs about 4,000 inotify watches per Vite; several
// task worktrees running Vite at once otherwise exhaust
// fs.inotify.max_user_watches, and a Vite then dies with ENOSPC or silently
// serves stale modules. tests/browser imports tests/fixtures and
// tests/helpers, and the Vite config imports tools/devBridge and tools/*.ts,
// so those stay watched.
const UNWATCHED_ROOT_FOLDERS: ReadonlySet<string> = new Set([
  'android',
  'content',
  'docs',
  'docs-site',
  'functions',
  'licenses',
  'migrations',
  'scripts',
  'wit',
  'workers',
]);

const WATCHED_SUBFOLDERS: Readonly<Record<string, ReadonlySet<string>>> = {
  tests: new Set(['browser', 'fixtures', 'helpers']),
  tools: new Set(['devBridge']),
};

/** True for a path below `root` that the dev server does not need to watch. */
export function isUnwatchedDevServerPath(file: string, root: string): boolean {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return false;
  const [top, sub, ...rest] = relative.split('/');
  if (UNWATCHED_ROOT_FOLDERS.has(top)) return true;
  const watched = WATCHED_SUBFOLDERS[top];
  if (!watched || !sub || watched.has(sub)) return false;
  // Files directly in tests/ or tools/ stay watched; their subfolders only when listed.
  // chokidar asks for a folder before its files, so a name without an extension
  // there is taken as a folder and skipped as a whole.
  return rest.length > 0 || path.extname(sub) === '';
}
