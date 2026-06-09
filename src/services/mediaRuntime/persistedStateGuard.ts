export interface PersistedRuntimeHandleViolation {
  path: string;
  key?: string;
  reason: string;
}

export interface PersistedStateRuntimeGuardResult {
  violations: PersistedRuntimeHandleViolation[];
  serializable: boolean;
  structuredClonePassed: boolean;
  jsonRoundtripPassed: boolean;
}

const RUNTIME_HANDLE_KEYS = new Set([
  'file',
  'fileHandle',
  'fileSystemHandle',
  'nativeFileHandle',
  'runtimeHandle',
  'objectUrl',
  'blobUrl',
  'sourceObjectUrl',
  'runtimeObjectUrl',
  'videoElement',
  'audioElement',
  'imageElement',
  'textCanvas',
  'webCodecsPlayer',
  'nativeDecoder',
  'videoFrame',
  'texture',
  'mixdownAudio',
  'mixdownBuffer',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRuntimeObjectReason(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }

  const constructors: Array<[string, string]> = [
    ['File', 'File handle'],
    ['Blob', 'Blob handle'],
    ['FileSystemFileHandle', 'file-system handle'],
    ['HTMLMediaElement', 'HTML media element'],
    ['HTMLVideoElement', 'HTML video element'],
    ['HTMLAudioElement', 'HTML audio element'],
    ['HTMLCanvasElement', 'HTML canvas element'],
    ['AudioContext', 'AudioContext'],
    ['VideoFrame', 'VideoFrame'],
    ['ImageBitmap', 'ImageBitmap'],
    ['Worker', 'Worker'],
  ];

  for (const [name, reason] of constructors) {
    const ctor = globalThis[name as keyof typeof globalThis];
    if (typeof ctor === 'function' && value instanceof ctor) {
      return reason;
    }
  }

  const constructorName = value.constructor?.name;
  if (constructorName?.startsWith('GPU')) {
    return 'GPU resource';
  }

  return null;
}

function appendPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key;
}

function getRuntimeFieldReason(key: string, value: unknown): string | null {
  if (RUNTIME_HANDLE_KEYS.has(key)) {
    return 'runtime handle field';
  }

  if (/ObjectUrl$/.test(key) && typeof value === 'string') {
    return 'object URL field';
  }

  return null;
}

export function findPersistedRuntimeHandleViolations(
  value: unknown,
): PersistedRuntimeHandleViolation[] {
  const violations: PersistedRuntimeHandleViolation[] = [];
  const seen = new WeakSet<object>();

  const visit = (entry: unknown, path: string, key?: string) => {
    if (typeof entry === 'string' && entry.startsWith('blob:')) {
      violations.push({
        path,
        key,
        reason: 'blob object URL',
      });
      return;
    }

    const runtimeReason = getRuntimeObjectReason(entry);
    if (runtimeReason) {
      violations.push({
        path,
        key,
        reason: runtimeReason,
      });
      return;
    }

    if (!isObject(entry)) {
      return;
    }

    if (seen.has(entry)) {
      return;
    }
    seen.add(entry);

    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [childKey, childValue] of Object.entries(entry)) {
      const childPath = appendPath(path, childKey);
      const fieldReason = getRuntimeFieldReason(childKey, childValue);
      if (fieldReason) {
        violations.push({
          path: childPath,
          key: childKey,
          reason: fieldReason,
        });
        continue;
      }
      visit(childValue, childPath, childKey);
    }
  };

  visit(value, '');
  return violations;
}

export function validatePersistedStateRuntimeFree(
  value: unknown,
): PersistedStateRuntimeGuardResult {
  const violations = findPersistedRuntimeHandleViolations(value);
  let structuredClonePassed = false;
  let jsonRoundtripPassed = false;

  try {
    structuredClone(value);
    structuredClonePassed = true;
  } catch {
    structuredClonePassed = false;
  }

  try {
    JSON.parse(JSON.stringify(value));
    jsonRoundtripPassed = true;
  } catch {
    jsonRoundtripPassed = false;
  }

  const serializable =
    violations.length === 0 &&
    structuredClonePassed &&
    jsonRoundtripPassed;

  return {
    violations,
    serializable,
    structuredClonePassed,
    jsonRoundtripPassed,
  };
}

export function isPersistedStateRuntimeFree(value: unknown): boolean {
  return validatePersistedStateRuntimeFree(value).serializable;
}
