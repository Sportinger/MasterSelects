export function isSeedance2ProviderId(providerId: string): boolean {
  return providerId === 'bytedance/seedance-2' || providerId === 'bytedance/seedance-2-fast';
}

export function getSeedanceReferenceValidationError(input: {
  hasAudioReference: boolean;
  hasVisualReference: boolean;
  providerId: string;
}): string | null {
  if (!isSeedance2ProviderId(input.providerId)) {
    return null;
  }

  if (input.hasAudioReference && !input.hasVisualReference) {
    return 'Seedance audio references need at least one image or video reference.';
  }

  return null;
}
