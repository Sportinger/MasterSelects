import { useSyncExternalStore } from 'react';

const MOBILE_POINTER_QUERY = '(pointer: coarse)';
const COMPACT_VIEWPORT_QUERY = '(max-width: 900px)';
const AUTOMATIC_MOBILE_LAYOUT_QUERIES = [
  MOBILE_POINTER_QUERY,
  COMPACT_VIEWPORT_QUERY,
] as const;

function hasMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  }).userAgentData;
  if (userAgentData?.mobile === true) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function isDetectedMobileDevice(): boolean {
  if (hasMobileUserAgent()) return true;
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_POINTER_QUERY).matches;
}

export function isAutomaticMobileLayoutEnvironment(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return AUTOMATIC_MOBILE_LAYOUT_QUERIES.some(
    (query) => window.matchMedia(query).matches,
  );
}

function subscribeToAutomaticMobileLayoutEnvironment(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const queries = AUTOMATIC_MOBILE_LAYOUT_QUERIES.map((query) => window.matchMedia(query));
  queries.forEach((query) => {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
    } else {
      query.addListener?.(onChange);
    }
  });

  return () => {
    queries.forEach((query) => {
      if (typeof query.removeEventListener === 'function') {
        query.removeEventListener('change', onChange);
      } else {
        query.removeListener?.(onChange);
      }
    });
  };
}

function subscribeToDetectedMobileDevice(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const query = window.matchMedia(MOBILE_POINTER_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  query.addListener?.(onChange);
  return () => query.removeListener?.(onChange);
}

export function useAutomaticMobileLayoutEnvironment(): boolean {
  return useSyncExternalStore(
    subscribeToAutomaticMobileLayoutEnvironment,
    isAutomaticMobileLayoutEnvironment,
    () => false,
  );
}

export function useDetectedMobileDevice(): boolean {
  return useSyncExternalStore(
    subscribeToDetectedMobileDevice,
    isDetectedMobileDevice,
    () => false,
  );
}
