// Save permanently > Save to a folder: the outcome the dialog must not phrase as "nothing changed".

/**
 * The editor already works on the folder copy, but it could not be confirmed as a
 * complete copy. Its message is complete: the temporary project was kept as well.
 */
export class FolderCopyUnverifiedError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`The project now opens from the chosen folder, but that copy could not be confirmed (${reason}). `
      + 'The temporary copy was kept, so nothing is lost: it stays listed as "Temporary" under the recent projects.', options);
    this.name = 'FolderCopyUnverifiedError';
  }
}
