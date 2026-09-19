export const PRODUCT_ANALYTICS_FAILURE_CODES = [
  'cancelled',
  'permission_denied',
  'authentication_required',
  'payment_required',
  'rate_limited',
  'file_missing',
  'file_unreadable',
  'storage_quota',
  'storage_unavailable',
  'unsupported_format',
  'decode_failed',
  'encode_failed',
  'network_unavailable',
  'request_timeout',
  'service_unavailable',
  'out_of_memory',
  'invalid_input',
  'invalid_response',
  'unknown',
] as const;

export type ProductAnalyticsFailureCode = typeof PRODUCT_ANALYTICS_FAILURE_CODES[number];

export const PRODUCT_ANALYTICS_MEDIA_IMPORT_FAILURE_STAGES = [
  'planning',
  'handle_storage',
  'signal_processing',
  'sequence_processing',
  'media_processing',
  'project_processing',
  'unknown',
] as const;

export const PRODUCT_ANALYTICS_PROJECT_FAILURE_STAGES = [
  'selection',
  'create',
  'load',
  'sync',
  'save',
  'unknown',
] as const;

export const PRODUCT_ANALYTICS_CHECKOUT_FAILURE_STAGES = [
  'session_create',
  'response_validation',
  'redirect',
  'unknown',
] as const;

export const PRODUCT_ANALYTICS_EXPORT_FAILURE_STAGES = [
  'processing',
  'download',
  'unknown',
] as const;

export type ProductAnalyticsMediaImportFailureStage =
  typeof PRODUCT_ANALYTICS_MEDIA_IMPORT_FAILURE_STAGES[number];
export type ProductAnalyticsProjectFailureStage =
  typeof PRODUCT_ANALYTICS_PROJECT_FAILURE_STAGES[number];
export type ProductAnalyticsCheckoutFailureStage =
  typeof PRODUCT_ANALYTICS_CHECKOUT_FAILURE_STAGES[number];
export type ProductAnalyticsExportFailureStage =
  typeof PRODUCT_ANALYTICS_EXPORT_FAILURE_STAGES[number];

interface ErrorDescriptor {
  message: string;
  name: string;
}

function describeError(error: unknown): ErrorDescriptor {
  if ((typeof DOMException !== 'undefined' && error instanceof DOMException) || error instanceof Error) {
    return {
      message: error.message.toLowerCase(),
      name: error.name.toLowerCase(),
    };
  }

  return {
    message: typeof error === 'string' ? error.toLowerCase() : '',
    name: '',
  };
}

/**
 * Converts local exceptions into a small, content-free taxonomy. The raw
 * message is inspected only in memory and is never returned or transmitted.
 */
export function classifyProductAnalyticsFailure(error: unknown): ProductAnalyticsFailureCode {
  const { message, name } = describeError(error);
  const text = `${name} ${message}`;

  if (/aborterror|cancel(?:led|ed|ation)?|aborted/.test(text)) return 'cancelled';
  if (/notallowederror|securityerror|permission|access denied|eacces|eperm/.test(text)) {
    return 'permission_denied';
  }
  if (/unauthorized|authentication|not authenticated|sign[ -]?in|required login|\b401\b/.test(text)) {
    return 'authentication_required';
  }
  if (/payment|required billing|subscription|required credits?|insufficient credits?|\b402\b/.test(text)) {
    return 'payment_required';
  }
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return 'rate_limited';
  if (/quotaexceedederror|quota|disk full|enospc/.test(text)) return 'storage_quota';
  if (/out of memory|out-of-memory|allocation failed|memory limit/.test(text)) return 'out_of_memory';
  if (/timeouterror|timed? out|timeout/.test(text)) return 'request_timeout';
  if (/networkerror|network error|network unavailable|failed to fetch|load failed|offline/.test(text)) {
    return 'network_unavailable';
  }
  if (/notfounderror|file not found|no such file|enoent|missing file/.test(text)) return 'file_missing';
  if (/notreadableerror|file.*(?:unreadable|could not be read)|read.*file.*failed/.test(text)) {
    return 'file_unreadable';
  }
  if (/quota|indexeddb|database|storage|transactioninactiveerror|versionerror|datacloneerror/.test(text)) {
    return 'storage_unavailable';
  }
  if (/notsupportederror|not supported|unsupported|unknown (?:codec|format)|invalid (?:codec|format)/.test(text)) {
    return 'unsupported_format';
  }
  if (/decode|decoder|demux|parse media|metadata.*failed/.test(text)) return 'decode_failed';
  if (/encode|encoder|mux|render.*failed/.test(text)) return 'encode_failed';
  if (/invalid json|unexpected token|invalid response|did not return|missing response/.test(text)) {
    return 'invalid_response';
  }
  if (/invalid|malformed|bad request|typeerror|\b400\b|\b422\b/.test(text)) return 'invalid_input';
  if (/service unavailable|backend.*not (?:running|available)|server error|\b50[0-9]\b/.test(text)) {
    return 'service_unavailable';
  }
  return 'unknown';
}
