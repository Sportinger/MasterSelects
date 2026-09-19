let activeOwner: symbol | null = null;

export function claimEditableValueTouchSession(owner: symbol): boolean {
  if (activeOwner !== null && activeOwner !== owner) return false;
  activeOwner = owner;
  return true;
}

export function releaseEditableValueTouchSession(owner: symbol): void {
  if (activeOwner === owner) activeOwner = null;
}

export function ownsEditableValueTouchSession(owner: symbol): boolean {
  return activeOwner === owner;
}

export function isEditableValueTouchSessionActive(): boolean {
  return activeOwner !== null;
}
