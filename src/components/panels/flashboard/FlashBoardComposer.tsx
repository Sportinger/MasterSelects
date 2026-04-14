import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardMultiShotPrompt } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import { getCatalogEntryPriceEstimate, getFlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import type { CatalogEntry } from '../../../services/flashboard/types';

type PopoverType = 'model' | 'aspect' | 'duration' | 'mode' | 'imageSize' | null;

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  serviceScope?: CatalogEntry['service'];
}

const MAX_MULTI_SHOTS = 5;

function getServiceLabel(service: CatalogEntry['service']): string {
  switch (service) {
    case 'kieai':
      return 'Kie.ai';
    case 'piapi':
      return 'PiAPI';
    case 'cloud':
      return 'Cloud';
    default:
      return service;
  }
}

function areMultiPromptsEqual(
  left: FlashBoardMultiShotPrompt[],
  right: FlashBoardMultiShotPrompt[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((shot, index) => (
    shot.index === right[index]?.index
    && shot.prompt === right[index]?.prompt
    && shot.duration === right[index]?.duration
  ));
}

function rebalanceMultiPrompts(
  shots: FlashBoardMultiShotPrompt[],
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  const boundedDuration = Math.max(1, Math.floor(totalDuration));
  const limitedShots = shots
    .slice(0, Math.min(MAX_MULTI_SHOTS, boundedDuration))
    .map((shot, index) => ({
      index: index + 1,
      prompt: shot.prompt ?? '',
      duration: Math.max(1, Math.floor(Number(shot.duration) || 1)),
    }));

  if (limitedShots.length === 0) {
    return [];
  }

  let remaining = boundedDuration;

  return limitedShots.map((shot, index) => {
    const remainingShots = limitedShots.length - index - 1;
    const maxForShot = Math.max(1, remaining - remainingShots);
    const nextDuration = index === limitedShots.length - 1
      ? remaining
      : Math.max(1, Math.min(shot.duration, maxForShot));

    remaining -= nextDuration;

    return {
      index: index + 1,
      prompt: shot.prompt,
      duration: nextDuration,
    };
  });
}

function createDefaultMultiPrompts(totalDuration: number): FlashBoardMultiShotPrompt[] {
  const firstShotDuration = Math.max(1, Math.floor(totalDuration / 2));

  return rebalanceMultiPrompts([
    { index: 1, prompt: '', duration: firstShotDuration },
    { index: 2, prompt: '', duration: Math.max(1, totalDuration - firstShotDuration) },
  ], totalDuration);
}

function addMultiPrompt(
  shots: FlashBoardMultiShotPrompt[],
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  const normalized = rebalanceMultiPrompts(shots, totalDuration);
  const maxShots = Math.min(MAX_MULTI_SHOTS, Math.max(1, totalDuration));

  if (normalized.length >= maxShots) {
    return normalized;
  }

  const donorIndex = normalized.reduce((bestIndex, shot, index, collection) => (
    shot.duration > collection[bestIndex].duration ? index : bestIndex
  ), 0);

  if (!normalized[donorIndex] || normalized[donorIndex].duration <= 1) {
    return normalized;
  }

  const next = normalized.map((shot, index) => (
    index === donorIndex
      ? { ...shot, duration: shot.duration - 1 }
      : shot
  ));

  next.push({
    index: next.length + 1,
    prompt: '',
    duration: 1,
  });

  return rebalanceMultiPrompts(next, totalDuration);
}

function removeMultiPrompt(
  shots: FlashBoardMultiShotPrompt[],
  removeIndex: number,
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  if (shots.length <= 2) {
    return rebalanceMultiPrompts(shots, totalDuration);
  }

  const removedDuration = shots[removeIndex]?.duration ?? 0;
  const next = shots.filter((_, index) => index !== removeIndex);
  const recipientIndex = Math.max(0, Math.min(removeIndex - 1, next.length - 1));

  if (next[recipientIndex]) {
    next[recipientIndex] = {
      ...next[recipientIndex],
      duration: next[recipientIndex].duration + removedDuration,
    };
  }

  return rebalanceMultiPrompts(next, totalDuration);
}

function buildFallbackPrompt(shots: FlashBoardMultiShotPrompt[]): string {
  return shots
    .map((shot) => shot.prompt.trim())
    .filter(Boolean)
    .join(' / ');
}

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  serviceScope,
}: FlashBoardComposerProps) {
  const board = useFlashBoardStore(selectActiveBoard);
  const composer = useFlashBoardStore((s) => s.composer);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const queueNode = useFlashBoardStore((s) => s.queueNode);

  const catalog = useMemo(() => getCatalogEntries(), []);
  const visibleCatalog = useMemo(
    () => (serviceScope ? catalog.filter((entry) => entry.service === serviceScope) : catalog),
    [catalog, serviceScope]
  );
  const [popover, setPopover] = useState<PopoverType>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [service, setService] = useState<CatalogEntry['service']>(serviceScope ?? initialService ?? 'kieai');
  const [providerId, setProviderId] = useState(initialProviderId ?? visibleCatalog[0]?.providerId ?? '');
  const [version, setVersion] = useState(initialVersion ?? visibleCatalog[0]?.versions[0] ?? '');
  const [mode, setMode] = useState('std');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [multiShots, setMultiShots] = useState(false);
  const [multiPrompt, setMultiPrompt] = useState<FlashBoardMultiShotPrompt[]>([]);

  const selectedEntry = useMemo(
    () => catalog.find((e) => e.service === service && e.providerId === providerId),
    [catalog, service, providerId]
  );
  const supportsAudio = selectedEntry?.supportsGenerateAudio === true;
  const supportsMultiShot = selectedEntry?.supportsMultiShot === true;
  const normalizedMultiPrompt = useMemo(
    () => multiShots ? rebalanceMultiPrompts(multiPrompt, duration) : [],
    [duration, multiPrompt, multiShots]
  );
  const effectiveGenerateAudio = supportsAudio && (generateAudio || multiShots);
  const effectivePrompt = useMemo(() => {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt) {
      return trimmedPrompt;
    }

    if (multiShots) {
      return buildFallbackPrompt(normalizedMultiPrompt);
    }

    return '';
  }, [multiShots, normalizedMultiPrompt, prompt]);
  const multiShotDurationTotal = useMemo(
    () => normalizedMultiPrompt.reduce((sum, shot) => sum + shot.duration, 0),
    [normalizedMultiPrompt]
  );
  const multiShotValidationError = useMemo(() => {
    if (!multiShots) {
      return null;
    }

    if (!supportsMultiShot) {
      return 'Multishot is not available for this model.';
    }

    const maxShots = Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));

    if (normalizedMultiPrompt.length < 2) {
      return 'Add at least 2 shots.';
    }

    if (normalizedMultiPrompt.length > maxShots) {
      return `Use at most ${maxShots} shots for ${duration}s.`;
    }

    if (multiShotDurationTotal !== duration) {
      return `Shot durations must add up to ${duration}s.`;
    }

    const emptyShot = normalizedMultiPrompt.find((shot) => shot.prompt.trim().length === 0);
    if (emptyShot) {
      return `Shot ${emptyShot.index} needs a prompt.`;
    }

    return null;
  }, [duration, multiShotDurationTotal, multiShots, normalizedMultiPrompt, supportsMultiShot]);
  const currentPrice = useMemo(() => (
    selectedEntry
      ? getFlashBoardPriceEstimate({
        service,
        providerId,
        outputType: selectedEntry.outputType,
        mode,
        duration,
        imageSize,
        generateAudio: effectiveGenerateAudio,
        multiShots,
      })
      : null
  ), [selectedEntry, service, providerId, mode, duration, imageSize, effectiveGenerateAudio, multiShots]);
  const canGenerate = Boolean(board && effectivePrompt) && !multiShotValidationError;
  const canAddShot = multiShots && normalizedMultiPrompt.length < Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));

  useEffect(() => {
    if (visibleCatalog.length === 0) {
      return;
    }

    const preferredEntry =
      visibleCatalog.find((entry) => {
        const serviceMatches = (serviceScope ?? initialService ?? service) === entry.service;
        const providerMatches = !initialProviderId || entry.providerId === initialProviderId;
        return serviceMatches && providerMatches;
      }) ?? visibleCatalog[0];

    setService(preferredEntry.service);
    setProviderId(preferredEntry.providerId);

    const nextVersion =
      initialVersion && preferredEntry.versions.includes(initialVersion)
        ? initialVersion
        : preferredEntry.versions[0] ?? '';
    setVersion(nextVersion);

    if (!preferredEntry.modes.includes(mode)) {
      setMode(preferredEntry.modes[0] ?? 'std');
    }
    if (!preferredEntry.durations.includes(duration)) {
      setDuration(preferredEntry.durations[0] ?? 5);
    }
    if (!preferredEntry.aspectRatios.includes(aspectRatio)) {
      setAspectRatio(preferredEntry.aspectRatios[0] ?? '16:9');
    }
    if (preferredEntry.imageSizes?.length) {
      setImageSize((current) => (
        preferredEntry.imageSizes?.includes(current)
          ? current
          : preferredEntry.imageSizes?.[0] ?? '1K'
      ));
    }
  }, [visibleCatalog, serviceScope, initialService, initialProviderId, initialVersion]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    if ((!supportsAudio || selectedEntry.outputType === 'image') && generateAudio) {
      setGenerateAudio(false);
    }

    if ((!supportsMultiShot || selectedEntry.outputType === 'image') && multiShots) {
      setMultiShots(false);
      setMultiPrompt([]);
    }
  }, [generateAudio, multiShots, selectedEntry, supportsAudio, supportsMultiShot]);

  useEffect(() => {
    if (!multiShots) {
      return;
    }

    if (!generateAudio) {
      setGenerateAudio(true);
    }

    setMultiPrompt((current) => (
      current.length > 0
        ? rebalanceMultiPrompts(current, duration)
        : createDefaultMultiPrompts(duration)
    ));
  }, [duration, generateAudio, multiShots]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    const nextOutputType = selectedEntry.outputType ?? 'video';
    const nextPatch: Partial<typeof composer> = {};
    const nextComposerMultiPrompt = multiShots ? normalizedMultiPrompt : [];

    if (composer.service !== service) nextPatch.service = service;
    if (composer.providerId !== providerId) nextPatch.providerId = providerId;
    if (composer.version !== version) nextPatch.version = version;
    if (composer.outputType !== nextOutputType) nextPatch.outputType = nextOutputType;
    if (composer.generateAudio !== effectiveGenerateAudio) nextPatch.generateAudio = effectiveGenerateAudio;
    if (composer.multiShots !== multiShots) nextPatch.multiShots = multiShots;
    if (!areMultiPromptsEqual(composer.multiPrompt, nextComposerMultiPrompt)) {
      nextPatch.multiPrompt = nextComposerMultiPrompt;
    }

    if (!selectedEntry.supportsImageToVideo) {
      if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
      if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
    }

    if (multiShots && composer.endMediaFileId !== undefined) {
      nextPatch.endMediaFileId = undefined;
    }

    if (!selectedEntry.supportsTextToImage && composer.referenceMediaFileIds.length > 0) {
      nextPatch.referenceMediaFileIds = [];
    }

    if (Object.keys(nextPatch).length > 0) {
      updateComposer(nextPatch);
    }
  }, [
    composer.endMediaFileId,
    composer.generateAudio,
    composer.multiPrompt,
    composer.multiShots,
    composer.outputType,
    composer.providerId,
    composer.referenceMediaFileIds,
    composer.service,
    composer.startMediaFileId,
    composer.version,
    effectiveGenerateAudio,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    selectedEntry,
    service,
    updateComposer,
    version,
  ]);

  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

  const handleProviderChange = useCallback((newService: CatalogEntry['service'], newId: string) => {
    setService(newService);
    setProviderId(newId);
    const entry = catalog.find((e) => e.service === newService && e.providerId === newId);
    if (entry) {
      setVersion(entry.versions[0] ?? '');
      if (!entry.modes.includes(mode)) setMode(entry.modes[0] ?? 'std');
      if (!entry.durations.includes(duration)) setDuration(entry.durations[0] ?? 5);
      if (!entry.aspectRatios.includes(aspectRatio)) setAspectRatio(entry.aspectRatios[0] ?? '16:9');
      if (entry.imageSizes?.length && !entry.imageSizes.includes(imageSize)) {
        setImageSize(entry.imageSizes[0] ?? '1K');
      }

      updateComposer({
        service: newService,
        providerId: newId,
        version: entry.versions[0] ?? '',
        outputType: entry.outputType ?? 'video',
        startMediaFileId: entry.supportsImageToVideo ? composer.startMediaFileId : undefined,
        endMediaFileId: entry.supportsImageToVideo && !multiShots ? composer.endMediaFileId : undefined,
        referenceMediaFileIds: entry.supportsTextToImage ? composer.referenceMediaFileIds : [],
      });
    }
    setPopover(null);
  }, [catalog, mode, duration, aspectRatio, imageSize, composer.endMediaFileId, composer.referenceMediaFileIds, composer.startMediaFileId, multiShots, updateComposer]);

  const handleGenerate = useCallback(() => {
    if (!board || !canGenerate || !selectedEntry) return;

    const node = createDraftNode(board.id);
    updateNodeRequest(node.id, {
      service,
      providerId,
      version,
      outputType: selectedEntry.outputType ?? 'video',
      mode,
      prompt: effectivePrompt,
      duration,
      aspectRatio,
      imageSize: selectedEntry.supportsTextToImage ? imageSize : undefined,
      generateAudio: effectiveGenerateAudio,
      multiShots,
      multiPrompt: multiShots ? normalizedMultiPrompt : undefined,
      startMediaFileId: selectedEntry.supportsImageToVideo ? composer.startMediaFileId : undefined,
      endMediaFileId: selectedEntry.supportsImageToVideo && !multiShots ? composer.endMediaFileId : undefined,
      referenceMediaFileIds: selectedEntry.supportsTextToImage ? composer.referenceMediaFileIds : [],
    });
    queueNode(node.id);
    setPrompt('');
  }, [
    board,
    canGenerate,
    composer.endMediaFileId,
    composer.referenceMediaFileIds,
    composer.startMediaFileId,
    createDraftNode,
    duration,
    aspectRatio,
    effectiveGenerateAudio,
    effectivePrompt,
    imageSize,
    mode,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    queueNode,
    selectedEntry,
    service,
    updateNodeRequest,
    version,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [handleGenerate]);

  const togglePopover = useCallback((type: PopoverType) => {
    setPopover((prev) => prev === type ? null : type);
  }, []);

  const handleAudioToggle = useCallback(() => {
    if (!supportsAudio || multiShots) {
      return;
    }

    setGenerateAudio((current) => !current);
  }, [multiShots, supportsAudio]);

  const handleMultiShotToggle = useCallback(() => {
    if (!supportsMultiShot) {
      return;
    }

    setMultiShots((current) => {
      const next = !current;

      if (next) {
        setGenerateAudio(true);
        setMultiPrompt((existing) => (
          existing.length > 0
            ? rebalanceMultiPrompts(existing, duration)
            : createDefaultMultiPrompts(duration)
        ));
      } else {
        setMultiPrompt([]);
      }

      return next;
    });
  }, [duration, supportsMultiShot]);

  const handleShotPromptChange = useCallback((index: number, value: string) => {
    setMultiPrompt((current) => current.map((shot, shotIndex) => (
      shotIndex === index ? { ...shot, prompt: value } : shot
    )));
  }, []);

  const handleShotDurationChange = useCallback((index: number, value: string) => {
    const nextDuration = Math.max(1, Math.floor(Number(value) || 1));
    setMultiPrompt((current) => rebalanceMultiPrompts(
      current.map((shot, shotIndex) => (
        shotIndex === index ? { ...shot, duration: nextDuration } : shot
      )),
      duration,
    ));
  }, [duration]);

  const handleAddShot = useCallback(() => {
    setMultiPrompt((current) => addMultiPrompt(current, duration));
  }, [duration]);

  const handleRemoveShot = useCallback((index: number) => {
    setMultiPrompt((current) => removeMultiPrompt(current, index, duration));
  }, [duration]);

  if (!board) return null;

  return (
    <div className="fb-bubble" onKeyDown={handleKeyDown} onMouseDown={(e) => e.stopPropagation()}>
      <div className="fb-bubble-row">
        <textarea
          className="fb-bubble-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={multiShots ? 'Overall scene or style (optional when using multishot)...' : 'Describe what to generate...'}
          rows={multiShots ? 2 : 1}
        />
        <button className="fb-bubble-close" onClick={() => setPrompt('')} title="Clear">&times;</button>
      </div>

      {multiShots && (
        <div className="fb-multishot-panel">
          <div className="fb-multishot-header">
            <span>Shots</span>
            <span className={`fb-multishot-total ${multiShotValidationError ? 'error' : ''}`}>
              {multiShotDurationTotal}/{duration}s
            </span>
          </div>

          <div className="fb-multishot-list">
            {normalizedMultiPrompt.map((shot, index) => (
              <div key={`shot-${shot.index}`} className="fb-multishot-item">
                <div className="fb-multishot-item-header">
                  <span className="fb-multishot-item-title">Shot {shot.index}</span>
                  <div className="fb-multishot-item-actions">
                    <input
                      className="fb-multishot-duration"
                      type="number"
                      min={1}
                      max={duration}
                      value={shot.duration}
                      onChange={(e) => handleShotDurationChange(index, e.target.value)}
                    />
                    <span className="fb-multishot-duration-unit">s</span>
                    <button
                      className="fb-multishot-remove"
                      type="button"
                      onClick={() => handleRemoveShot(index)}
                      disabled={normalizedMultiPrompt.length <= 2}
                      title="Remove shot"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <textarea
                  className="fb-multishot-input"
                  value={shot.prompt}
                  onChange={(e) => handleShotPromptChange(index, e.target.value)}
                  placeholder={`Shot ${shot.index} prompt`}
                  rows={2}
                  maxLength={500}
                />
                <div className="fb-multishot-count">{shot.prompt.length}/500</div>
              </div>
            ))}
          </div>

          <div className="fb-multishot-footer">
            <button
              className="fb-multishot-add"
              type="button"
              onClick={handleAddShot}
              disabled={!canAddShot}
            >
              + Shot
            </button>
            <span className={`fb-multishot-hint ${multiShotValidationError ? 'error' : ''}`}>
              {multiShotValidationError ?? 'Multishot uses one start frame only and forces sound.'}
            </span>
          </div>
        </div>
      )}

      <div className="fb-bubble-bar">
        <div className="fb-pill-group" ref={popoverRef}>
          <button className="fb-pill" onClick={() => togglePopover('model')} title="Model">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </button>
          <button className={`fb-pill ${popover === 'aspect' ? 'active' : ''}`} onClick={() => togglePopover('aspect')}>
            {aspectRatio}
          </button>
          {selectedEntry && selectedEntry.durations.length > 0 && (
            <button className={`fb-pill ${popover === 'duration' ? 'active' : ''}`} onClick={() => togglePopover('duration')}>
              {duration}s
            </button>
          )}
          {selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length ? (
            <button className={`fb-pill ${popover === 'imageSize' ? 'active' : ''}`} onClick={() => togglePopover('imageSize')}>
              {imageSize}
            </button>
          ) : null}
          {selectedEntry && selectedEntry.modes.length > 1 && (
            <button className={`fb-pill ${popover === 'mode' ? 'active' : ''}`} onClick={() => togglePopover('mode')}>
              {mode}
            </button>
          )}
          {supportsAudio && (
            <button className={`fb-pill ${effectiveGenerateAudio ? 'active' : ''}`} onClick={handleAudioToggle} title={multiShots ? 'Required for multishot' : 'Generate sound'}>
              {multiShots ? 'Sound req.' : 'Sound'}
            </button>
          )}
          {supportsMultiShot && (
            <button className={`fb-pill ${multiShots ? 'active' : ''}`} onClick={handleMultiShotToggle} title="Split the generation into multiple shots">
              Multi-shot
            </button>
          )}

          {popover === 'model' && (
            <div className="fb-popover fb-popover-model">
              <div className="fb-popover-title">Model</div>
              {(serviceScope ? [serviceScope] : ['kieai', 'cloud']).map((svc) => {
                const providers = visibleCatalog.filter((e) => e.service === svc);
                if (providers.length === 0) return null;
                return (
                  <div key={svc} className="fb-popover-group">
                    {!serviceScope && <div className="fb-popover-label">{getServiceLabel(svc as CatalogEntry['service'])}</div>}
                    {serviceScope && providers.length > 1 && (
                      <div className="fb-popover-label">{getServiceLabel(svc as CatalogEntry['service'])}</div>
                    )}
                    <div className="fb-popover-pills">
                      {providers.map((p) => {
                        const estimate = getCatalogEntryPriceEstimate(p, {
                          duration,
                          imageSize,
                          mode,
                          generateAudio: p.supportsGenerateAudio ? effectiveGenerateAudio : false,
                          multiShots: p.supportsMultiShot ? multiShots : false,
                        });

                        return (
                          <button
                            key={p.providerId}
                            className={`fb-popover-pill ${service === svc && providerId === p.providerId ? 'active' : ''}`}
                            onClick={() => handleProviderChange(svc as CatalogEntry['service'], p.providerId)}
                          >
                            <span className="fb-popover-pill-label">{p.name.replace(' (Kie.ai)', '')}</span>
                            {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {popover === 'aspect' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Aspect Ratio</div>
              <div className="fb-popover-pills">
                {selectedEntry.aspectRatios.map((ar) => (
                  <button
                    key={ar}
                    className={`fb-popover-pill ${aspectRatio === ar ? 'active' : ''}`}
                    onClick={() => { setAspectRatio(ar); setPopover(null); }}
                  >
                    <span className="fb-popover-pill-label">{ar}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {popover === 'duration' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Duration</div>
              <div className="fb-popover-pills">
                {selectedEntry.durations.map((d) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode,
                    duration: d,
                    imageSize,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                  });

                  return (
                    <button
                      key={d}
                      className={`fb-popover-pill ${duration === d ? 'active' : ''}`}
                      onClick={() => { setDuration(d); setPopover(null); }}
                    >
                      <span className="fb-popover-pill-label">{d}s</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {popover === 'imageSize' && selectedEntry?.imageSizes?.length ? (
            <div className="fb-popover">
              <div className="fb-popover-title">Image Size</div>
              <div className="fb-popover-pills">
                {selectedEntry.imageSizes.map((size) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode,
                    duration,
                    imageSize: size,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                  });

                  return (
                    <button
                      key={size}
                      className={`fb-popover-pill ${imageSize === size ? 'active' : ''}`}
                      onClick={() => { setImageSize(size); setPopover(null); }}
                    >
                      <span className="fb-popover-pill-label">{size}</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {popover === 'mode' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Mode</div>
              <div className="fb-popover-pills">
                {selectedEntry.modes.map((m) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode: m,
                    duration,
                    imageSize,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                  });

                  return (
                    <button
                      key={m}
                      className={`fb-popover-pill ${mode === m ? 'active' : ''}`}
                      onClick={() => { setMode(m); setPopover(null); }}
                    >
                      <span className="fb-popover-pill-label">{m}</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          className="fb-generate"
          disabled={!canGenerate}
          onClick={handleGenerate}
          title={currentPrice ? `${currentPrice.fullLabel} (Ctrl+Enter)` : 'Generate (Ctrl+Enter)'}
        >
          {currentPrice ? `\u25B6 Generate \u00B7 ${currentPrice.compactLabel}` : '\u25B6 Generate'}
        </button>
      </div>
    </div>
  );
}
