import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry } from '../../../services/flashboard/types';

type PopoverType = 'model' | 'aspect' | 'duration' | 'mode' | 'imageSize' | null;

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  serviceScope?: CatalogEntry['service'];
}

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

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  serviceScope,
}: FlashBoardComposerProps) {
  const board = useFlashBoardStore(selectActiveBoard);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
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

  const selectedEntry = useMemo(
    () => catalog.find((e) => e.service === service && e.providerId === providerId),
    [catalog, service, providerId]
  );

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

  // Close popover on outside click
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
    }
    setPopover(null);
  }, [catalog, mode, duration, aspectRatio, imageSize]);

  const handleGenerate = useCallback(() => {
    if (!board || !prompt.trim()) return;
    const node = createDraftNode(board.id);
    updateNodeRequest(node.id, {
      service,
      providerId,
      version,
      outputType: selectedEntry?.outputType ?? 'video',
      mode,
      prompt: prompt.trim(),
      duration,
      aspectRatio,
      imageSize: selectedEntry?.supportsTextToImage ? imageSize : undefined,
      referenceMediaFileIds: [],
    });
    queueNode(node.id);
    setPrompt('');
  }, [board, prompt, service, providerId, version, mode, duration, aspectRatio, imageSize, selectedEntry, createDraftNode, updateNodeRequest, queueNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [handleGenerate]);

  const togglePopover = useCallback((type: PopoverType) => {
    setPopover((prev) => prev === type ? null : type);
  }, []);

  if (!board) return null;

  return (
    <div className="fb-bubble" onKeyDown={handleKeyDown} onMouseDown={(e) => e.stopPropagation()}>
      <div className="fb-bubble-row">
        <textarea
          className="fb-bubble-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to generate..."
          rows={1}
        />
        <button className="fb-bubble-close" onClick={() => setPrompt('')} title="Clear">&times;</button>
      </div>

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

          {/* Popovers */}
          {popover === 'model' && (
            <div className="fb-popover fb-popover-model">
              <div className="fb-popover-title">Model</div>
              {(serviceScope ? [serviceScope] : ['kieai', 'piapi', 'cloud']).map((svc) => {
                const providers = visibleCatalog.filter((e) => e.service === svc);
                if (providers.length === 0) return null;
                return (
                  <div key={svc} className="fb-popover-group">
                    {!serviceScope && <div className="fb-popover-label">{getServiceLabel(svc as CatalogEntry['service'])}</div>}
                    {serviceScope && providers.length > 1 && (
                      <div className="fb-popover-label">{getServiceLabel(svc as CatalogEntry['service'])}</div>
                    )}
                    <div className="fb-popover-pills">
                      {providers.map((p) => (
                        <button
                          key={p.providerId}
                          className={`fb-popover-pill ${service === svc && providerId === p.providerId ? 'active' : ''}`}
                          onClick={() => handleProviderChange(svc as CatalogEntry['service'], p.providerId)}
                        >
                          {p.name.replace(' (Kie.ai)', '')}
                        </button>
                      ))}
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
                    {ar}
                  </button>
                ))}
              </div>
            </div>
          )}

          {popover === 'duration' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Duration</div>
              <div className="fb-popover-pills">
                {selectedEntry.durations.map((d) => (
                  <button
                    key={d}
                    className={`fb-popover-pill ${duration === d ? 'active' : ''}`}
                    onClick={() => { setDuration(d); setPopover(null); }}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {popover === 'imageSize' && selectedEntry?.imageSizes?.length ? (
            <div className="fb-popover">
              <div className="fb-popover-title">Image Size</div>
              <div className="fb-popover-pills">
                {selectedEntry.imageSizes.map((size) => (
                  <button
                    key={size}
                    className={`fb-popover-pill ${imageSize === size ? 'active' : ''}`}
                    onClick={() => { setImageSize(size); setPopover(null); }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {popover === 'mode' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Mode</div>
              <div className="fb-popover-pills">
                {selectedEntry.modes.map((m) => (
                  <button
                    key={m}
                    className={`fb-popover-pill ${mode === m ? 'active' : ''}`}
                    onClick={() => { setMode(m); setPopover(null); }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          className="fb-generate"
          disabled={!prompt.trim()}
          onClick={handleGenerate}
          title="Generate (Ctrl+Enter)"
        >
          &#9654; Generate
        </button>
      </div>
    </div>
  );
}
