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
  initialAspectRatio?: string;
  initialDuration?: number;
  initialGenerateAudio?: boolean;
  initialImageSize?: string;
  initialMode?: string;
  initialVersion: string | undefined;
  setAspectRatio: Dispatch<SetStateAction<string>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setGenerateAudio: Dispatch<SetStateAction<boolean>>;
  setImageSize: Dispatch<SetStateAction<string>>;
  setMode: Dispatch<SetStateAction<string>>;
  setProviderId: Dispatch<SetStateAction<string>>;
  setService: Dispatch<SetStateAction<TService>>;
  setVersion: Dispatch<SetStateAction<string>>;
}

export function useFlashBoardInitialEntrySync<TService>({
  initialEntry,
  initialAspectRatio,
  initialDuration,
  initialGenerateAudio,
  initialImageSize,
  initialMode,
  initialVersion,
  setAspectRatio,
  setDuration,
  setGenerateAudio,
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

    const initialTargetKey = [
      String(initialEntry.service),
      initialEntry.providerId,
      initialVersion ?? '',
      initialMode ?? '',
      initialDuration ?? '',
      initialAspectRatio ?? '',
      initialImageSize ?? '',
      initialGenerateAudio ?? '',
    ].join(':');
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

      setMode((current) => {
        if (initialMode && initialEntry.modes.includes(initialMode)) return initialMode;
        return initialEntry.modes.includes(current) ? current : initialEntry.modes[0] ?? 'std';
      });
      setDuration((current) => (
        typeof initialDuration === 'number' && initialEntry.durations.includes(initialDuration)
          ? initialDuration
          : initialEntry.durations.length > 0 && !initialEntry.durations.includes(current)
            ? initialEntry.durations[0] ?? 5
            : current
      ));
      setAspectRatio((current) => (
        initialAspectRatio && initialEntry.aspectRatios.includes(initialAspectRatio)
          ? initialAspectRatio
          : initialEntry.aspectRatios.length > 0 && !initialEntry.aspectRatios.includes(current)
            ? initialEntry.aspectRatios[0] ?? '16:9'
            : current
      ));
      if (initialEntry.imageSizes?.length) {
        setImageSize((current) => (
          initialImageSize && initialEntry.imageSizes?.includes(initialImageSize)
            ? initialImageSize
            : initialEntry.imageSizes?.includes(current)
            ? current
            : initialEntry.imageSizes?.[0] ?? '1K'
        ));
      }
      if (typeof initialGenerateAudio === 'boolean') {
        setGenerateAudio(initialGenerateAudio);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    initialEntry,
    initialAspectRatio,
    initialDuration,
    initialGenerateAudio,
    initialImageSize,
    initialMode,
    initialVersion,
    setAspectRatio,
    setDuration,
    setGenerateAudio,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
  ]);
}
