// "The open project changed" notices for the phone shell. projectFileService has no change event,
// so the phone's project state (usePhoneProjectBoot) otherwise only follows its slow poll. Whoever
// opens or closes a project from the phone calls notifyPhoneProjectStateChanged() right after, so
// the home screen never shows a stale "Back to editing" for a project that is already closed.

const listeners = new Set<() => void>();

export function subscribePhoneProjectStateChanges(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function notifyPhoneProjectStateChanged(): void {
  for (const listener of [...listeners]) listener();
}
