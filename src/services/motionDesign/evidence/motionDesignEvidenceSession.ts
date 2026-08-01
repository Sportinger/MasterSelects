const MOTION_DESIGN_EVIDENCE_NONCE = /^[a-z0-9]{8,64}$/;

export function getMotionDesignEvidenceSessionNonce(value: string | URL): string | null {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const markers = url.searchParams.getAll('motionDesignEvidenceSession');
  if (markers.length !== 1) return null;
  const marker = markers[0];
  if (!MOTION_DESIGN_EVIDENCE_NONCE.test(marker)) return null;

  return url.hostname.toLowerCase() === `motion-md0-${marker}.localhost`
    ? marker
    : null;
}

export function isMotionDesignEvidenceSessionUrl(value: string | URL): boolean {
  return getMotionDesignEvidenceSessionNonce(value) !== null;
}
