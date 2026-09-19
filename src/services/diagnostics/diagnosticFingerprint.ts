/**
 * Runtime failure fingerprinting and classification.
 *
 * A fingerprint groups the "same" error across users and builds so the Stats
 * view can rank failures instead of listing every occurrence. Chunk hashes,
 * line/column numbers, URLs, IDs, and numbers are normalized away first.
 */

export type RuntimeFailureCode =
  | 'cancelled'
  | 'chunk_load_failed'
  | 'decode_failed'
  | 'encode_failed'
  | 'javascript_error'
  | 'network_unavailable'
  | 'out_of_memory'
  | 'permission_denied'
  | 'react_render_error'
  | 'request_timeout'
  | 'resource_load_failed'
  | 'storage_quota'
  | 'storage_unavailable'
  | 'unhandled_rejection'
  | 'unsupported_format'
  | 'webgpu_device_lost'
  | 'webgpu_out_of_memory'
  | 'webgpu_uncaptured_error';

export interface RuntimeFailureDescriptor {
  component?: string;
  errorName?: string;
  message: string;
  stack?: string;
  /** Reporter stage such as `window_error`, `unhandledrejection`, `logger_error`. */
  stage: string;
}

const CHUNK_LOAD_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading (?:css )?chunk [\w-]+ failed|chunkloaderror|unable to preload css/i;

export function classifyRuntimeFailure(descriptor: RuntimeFailureDescriptor): RuntimeFailureCode {
  const name = (descriptor.errorName ?? '').toLowerCase();
  const message = descriptor.message.toLowerCase();
  const { stage } = descriptor;

  if (stage === 'webgpu_device_lost') return 'webgpu_device_lost';
  if (stage === 'webgpu_uncapturederror') {
    return name.includes('outofmemory') || /out of memory/.test(message)
      ? 'webgpu_out_of_memory'
      : 'webgpu_uncaptured_error';
  }
  if (stage === 'chunk_load' || CHUNK_LOAD_PATTERN.test(message)) return 'chunk_load_failed';
  if (stage === 'resource_error') {
    return /\/assets\/[^\s]+\.(?:m?js|css)\b/i.test(message) ? 'chunk_load_failed' : 'resource_load_failed';
  }
  if (stage === 'react_render' || stage === 'react_caught' || stage === 'react_recoverable') {
    return 'react_render_error';
  }
  if (name === 'aborterror' || /\baborted\b|\bcancell?ed\b/.test(message)) return 'cancelled';
  if (name === 'quotaexceedederror' || /quota exceeded|quotaexceeded|enospc|disk full/.test(message)) {
    return 'storage_quota';
  }
  if (/out of memory|out-of-memory|allocation failed|memory limit/.test(message)) return 'out_of_memory';
  if (name === 'notallowederror' || name === 'securityerror' || /permission denied|not allowed by the user agent/.test(message)) {
    return 'permission_denied';
  }
  if (name === 'timeouterror' || /\btimed? ?out\b|\btimeout\b/.test(message)) return 'request_timeout';
  if (
    name === 'networkerror'
    || /failed to fetch|networkerror|network error|load failed|err_network|err_internet_disconnected|err_connection/.test(message)
  ) {
    return 'network_unavailable';
  }
  if (name === 'notsupportederror' || /not supported|unsupported (?:codec|format|media|file)/.test(message)) {
    return 'unsupported_format';
  }
  if (name === 'encodingerror' || /decod(?:e|er|ing) (?:failed|error)|demux(?:er|ing)? (?:failed|error)/.test(message)) {
    return 'decode_failed';
  }
  if (/encod(?:e|er|ing) (?:failed|error)|mux(?:er|ing)? (?:failed|error)/.test(message)) return 'encode_failed';
  if (
    (name === 'invalidstateerror' || name === 'versionerror' || name === 'transactioninactiveerror' || name === 'unknownerror')
    && /indexeddb|idb|database|storage|transaction/.test(message)
  ) {
    return 'storage_unavailable';
  }
  return stage === 'unhandledrejection' ? 'unhandled_rejection' : 'javascript_error';
}

export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)'"]+/gi, '<url>')
    .replace(/blob:[^\s)'"]+/gi, '<blob>')
    .replace(/data:[a-z0-9/+.-]+;base64,[a-z0-9+/=]+/gi, '<data>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Returns the first stack frame that points at application code, with build
 * hashes and line/column numbers removed so it survives redeploys.
 */
export function topStackFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/(?:^at |@|\.(?:m?js|tsx?|jsx?)\b)/.test(line)) continue;
    if (/^(?:[A-Za-z]*Error|Uncaught)\b/.test(line) && !/ at |@/.test(line)) continue;
    return line
      .replace(/^at\s+/, '')
      .replace(/https?:\/\/[^/\s]+/gi, '')
      .replace(/\?[^:)\s]*/g, '')
      .replace(/(\/assets\/[a-z0-9_.-]+?)-[a-z0-9_-]{6,12}(\.m?js)/gi, '$1$2')
      .replace(/:\d+:\d+(\)?)$/, '$1')
      .replace(/:\d+(\)?)$/, '$1')
      .slice(0, 200);
  }
  return null;
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function computeFingerprint(parts: Array<string | null | undefined>): string {
  const material = parts.map((part) => part ?? '').join('');
  return fnv1a(material, 0x811c9dc5).toString(16).padStart(8, '0')
    + fnv1a(material, 0x9747b28c).toString(16).padStart(8, '0');
}

export function buildRuntimeFingerprint(descriptor: RuntimeFailureDescriptor): string {
  return computeFingerprint([
    descriptor.stage,
    descriptor.component,
    descriptor.errorName,
    normalizeErrorMessage(descriptor.message),
    topStackFrame(descriptor.stack),
  ]);
}
