export function isSeedance2ProviderId(providerId: string): boolean {
  return providerId === 'bytedance/seedance-2' || providerId === 'bytedance/seedance-2-fast';
}

export function getSeedanceReferenceValidationError(input: {
  hasReferenceMedia: boolean;
  providerId: string;
}): string | null {
  if (!isSeedance2ProviderId(input.providerId)) {
    return null;
  }

  if (input.hasReferenceMedia) {
    return 'Seedance multimodal references are temporarily disabled. Use the IN and OUT frame slots for exact first/last-frame mode.';
  }

  return null;
}
