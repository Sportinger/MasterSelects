export class BatchSourceExportCancelledError extends Error {
  constructor(message = 'Source media export was cancelled') {
    super(message);
    this.name = 'BatchSourceExportCancelledError';
  }
}

export class BatchSourceExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchSourceExportUnsupportedError';
  }
}

export function isBatchSourceExportCancelledError(
  error: unknown,
): error is BatchSourceExportCancelledError {
  return error instanceof BatchSourceExportCancelledError
    || (error instanceof Error && error.name === 'BatchSourceExportCancelledError');
}
