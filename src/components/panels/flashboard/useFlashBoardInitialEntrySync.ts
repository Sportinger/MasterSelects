import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

interface FlashBoardInitialEntrySyncEntry<TService> {
  aspectRatios: readonly string[];
  durations: readonly number[];
  imageSizes?: readonly string[];
  modes: readonly string[];
  providerId: string;
  service: TService;
  versions: readonly string[];
}

interface UseFlashBoardInitialEntrySyncInput<TService> {
  initialEntry: FlashBoardInitialEntrySyncEntry<TService> | undefined;
  initialVersion: string | undefined;
  setAspectRatio: Dispatch<SetStateAction<string>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setImageSize: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<string>>;
  setProviderId: Dispatch<SetStateAction<string>>;
  setService: Dispatch<SetStateAction<TService>>;
  setVersion: Dispatch<SetStateAction<string>>;
}

export function useFlashBoardInitialEntrySync<TService>({
  initialEntry,
  initialVersion,
  setAspectRatio,
  setDuration,
  setImageSize,
  setMode,
  setProviderId,
  setService,
  setVersion,
}: UseFlashBoardInitialEntrySyncInput<TService>) {
  const appliedInitialTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialEntry) {
      return;
    }

    const initialTargetKey = `${String(initialEntry.service)}:${initialEntry.providerId}:${initialVersion ?? ''}`;
    if (appliedInitialTargetRef.current === initialTargetKey) {
      return;
    }
    appliedInitialTargetRef.current = initialTargetKey;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      setService(initialEntry.service);
      setProviderId(initialEntry.providerId);

      const nextVersion =
        initialVersion && initialEntry.versions.includes(initialVersion)
          ? initialVersion
          : initialEntry.versions[0] ?? '';
      setVersion(nextVersion);

      setMode((current) => (
        initialEntry.modes.includes(current) ? current : initialEntry.modes[0] ?? 'std'
      ));
      setDuration((current) => (
        initialEntry.durations.length > 0 && !initialEntry.durations.includes(current)
          ? initialEntry.durations[0] ?? 5
          : current
      ));
      setAspectRatio((current) => (
        initialEntry.aspectRatios.length > 0 && !initialEntry.aspectRatios.includes(current)
          ? initialEntry.aspectRatios[0] ?? '16:9'
          : current
      ));
      if (initialEntry.imageSizes?.length) {
        setImageSize((current) => (
          initialEntry.imageSizes?.includes(current)
            ? current
            : initialEntry.imageSizes?.[0] ?? '1K'
        ));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    initialEntry,
    initialVersion,
    setAspectRatio,
    setDuration,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
  ]);
}
