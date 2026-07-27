import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  useMuscriptorStore,
  type MuscriptorSetupStatus,
} from '../../stores/muscriptorStore';
import { useTimelineStore } from '../../stores/timeline';
import { resolveAudibleAudioClip } from '../../services/audio/audioClipResolution';
import { getMuscriptorService, MUSCRIPTOR_INSTRUMENT_GROUPS } from '../../services/muscriptor';
import type { MuscriptorModelVariant } from '../../services/nativeHelper';
import { disabledStyle, muscriptorStyles as styles } from './muscriptorSetup/styles';

interface MuscriptorSetupDialogProps {
  sourceClipId?: string;
  onClose: () => void;
}

const MODEL_OPTIONS: ReadonlyArray<{
  value: MuscriptorModelVariant;
  label: string;
  size: string;
  hint: string;
}> = [
  { value: 'small', label: 'Small', size: '103M parameters', hint: 'Best default for local/CPU use' },
  { value: 'medium', label: 'Medium', size: '307M parameters', hint: 'Accuracy/speed balance' },
  { value: 'large', label: 'Large', size: '1.4B parameters', hint: 'Most accurate; GPU recommended' },
];

const BUSY_SETUP_STATUSES = new Set(['installing', 'downloading-model', 'starting']);

function formatInstrument(value: string): string {
  return value.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function getStatusLabel(status: MuscriptorSetupStatus): string {
  return ({
    'not-checked': 'Not checked',
    'not-available': 'Native Helper unavailable',
    'not-installed': 'Setup required',
    installing: 'Installing environment',
    'model-needed': 'Model download required',
    'downloading-model': 'Downloading model',
    installed: 'Installed',
    starting: 'Starting local server',
    ready: 'Ready locally',
    error: 'Error',
  })[status];
}

export function MuscriptorSetupDialog({ sourceClipId, onClose }: MuscriptorSetupDialogProps) {
  const state = useMuscriptorStore();
  const timelineClips = useTimelineStore(store => store.clips);
  const timelineKeyframes = useTimelineStore(store => store.clipKeyframes);
  const commitMidiTranscription = useTimelineStore(store => store.commitMidiTranscription);
  const [hfToken, setHfToken] = useState('');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourceClip = sourceClipId ? timelineClips.find(clip => clip.id === sourceClipId) ?? null : null;
  const resolvedSource = sourceClip ? resolveAudibleAudioClip(timelineClips, sourceClip.id) : null;
  const setupBusy = BUSY_SETUP_STATUSES.has(state.setupStatus);
  const busy = setupBusy || state.isProcessing;
  const selectedModelDownloaded = state.modelsDownloaded.includes(state.variant);
  const canDownloadModel = ['model-needed', 'installed', 'error'].includes(state.setupStatus);
  const canStartServer = state.setupStatus === 'installed' && selectedModelDownloaded;
  const instruments = useMemo(() => (
    state.availableInstruments.length > 0
      ? state.availableInstruments
      : [...MUSCRIPTOR_INSTRUMENT_GROUPS]
  ), [state.availableInstruments]);

  useEffect(() => {
    void getMuscriptorService().checkStatus();
    return () => abortRef.current?.abort();
  }, []);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const handleSetup = async () => {
    setResultMessage(null);
    await getMuscriptorService().setup();
  };

  const handleDownload = async () => {
    setResultMessage(null);
    try {
      await getMuscriptorService().downloadModel({ variant: state.variant, hfToken });
    } finally {
      // The gated-model token is deliberately component-local and short-lived.
      setHfToken('');
    }
  };

  const handleStart = async () => {
    setResultMessage(null);
    await getMuscriptorService().start({ variant: state.variant, device: state.device });
  };

  const handleRun = async () => {
    if (!sourceClip || !resolvedSource) return;
    const currentSourceClip = timelineClips.find(clip => clip.id === sourceClip.id);
    const currentResolution = currentSourceClip
      ? resolveAudibleAudioClip(timelineClips, currentSourceClip.id)
      : null;
    if (!currentSourceClip || !currentResolution) {
      state.setError('The source clip is no longer available.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setResultMessage(null);
    state.setError(null);

    try {
      const transcription = await getMuscriptorService().transcribeClip(currentSourceClip, {
        clips: timelineClips,
        keyframes: timelineKeyframes.get(currentResolution.audioClip.id),
        instruments: state.instruments,
        signal: controller.signal,
      });
      if (!transcription) return;

      const commit = commitMidiTranscription({
        // Keep the originally requested clip id so the atomic commit re-checks
        // locks on both a linked video clip and its audible audio partner.
        sourceClipId: currentSourceClip.id,
        sourceFingerprint: transcription.sourceFingerprint,
        processingStateHash: transcription.processingStateHash,
        sourceFileKey: transcription.sourceFileKey,
        tracks: transcription.tracks,
        provenance: {
          provider: 'muscriptor',
          model: state.variant,
          jobId: transcription.jobId,
          license: 'CC BY-NC 4.0',
        },
      });

      if (!commit) {
        state.setError(
          transcription.tracks.length === 0
            ? 'MuScriptor found no valid notes in this clip.'
            : 'The source clip changed or became locked while transcription was running.',
        );
        return;
      }
      setResultMessage(`Created ${commit.trackIds.length} MIDI track${commit.trackIds.length === 1 ? '' : 's'}.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        state.setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancel = async () => {
    abortRef.current?.abort();
    await getMuscriptorService().cancel();
  };

  const toggleInstrument = (instrument: string) => {
    const selected = new Set(state.instruments);
    if (selected.has(instrument)) selected.delete(instrument);
    else selected.add(instrument);
    state.setInstruments([...selected]);
  };

  const progress = state.isProcessing ? state.jobProgress : state.setupProgress;
  const progressLabel = state.isProcessing
    ? `Transcribing${state.noteCount ? ` · ${state.noteCount} notes` : ''}`
    : state.setupStep ?? getStatusLabel(state.setupStatus);

  return (
    <div style={styles.backdrop} onClick={onBackdrop}>
      <div style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="muscriptor-title">
        <header style={styles.header}>
          <div>
            <h2 id="muscriptor-title" style={styles.title}>Music to MIDI</h2>
            <p style={styles.subtitle}>Local multi-instrument transcription powered by MuScriptor</p>
          </div>
          <button type="button" aria-label="Close" disabled={busy} style={{ ...styles.close, ...disabledStyle(busy) }} onClick={close}>
            ×
          </button>
        </header>

        <div style={styles.body}>
          <section style={styles.section}>
            <div style={{ ...styles.row, justifyContent: 'space-between' }}>
              <span style={styles.status}>{getStatusLabel(state.setupStatus)}</span>
              <button type="button" style={{ ...styles.button, ...disabledStyle(busy) }} disabled={busy} onClick={() => void getMuscriptorService().checkStatus()}>
                Refresh status
              </button>
            </div>
            {(setupBusy || state.isProcessing) && (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...styles.row, justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={styles.muted}>{progressLabel}</span><span style={styles.muted}>{Math.round(progress)}%</span>
                </div>
                <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${progress}%` }} /></div>
              </div>
            )}
            {state.setupLog.length > 0 && <pre style={styles.log}>{state.setupLog.slice(-8).join('\n')}</pre>}
            {state.errorMessage && <div style={{ ...styles.error, marginTop: 10 }}>{state.errorMessage}</div>}
            {resultMessage && <div style={{ ...styles.success, marginTop: 10 }}>{resultMessage}</div>}
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Local model</h3>
            <div style={styles.grid}>
              <label style={styles.label}>Variant
                <select style={styles.input} value={state.variant} disabled={busy || state.setupStatus === 'ready'} onChange={event => state.setVariant(event.target.value as MuscriptorModelVariant)}>
                  {MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label} · {option.size}</option>)}
                </select>
              </label>
              <label style={styles.label}>Compute device
                <select style={styles.input} value={state.device} disabled={busy || state.setupStatus === 'ready'} onChange={event => state.setDevice(event.target.value as typeof state.device)}>
                  <option value="auto">Auto</option><option value="cpu">CPU</option><option value="cuda">CUDA GPU</option>
                </select>
              </label>
            </div>
            <p style={{ ...styles.muted, marginTop: 8 }}>{MODEL_OPTIONS.find(option => option.value === state.variant)?.hint}</p>
            <label style={{ ...styles.label, marginTop: 12 }}>Hugging Face token (used once, never saved)
              <input type="password" autoComplete="off" style={styles.input} value={hfToken} disabled={busy} onChange={event => setHfToken(event.target.value)} placeholder="hf_... (only if gated download requires it)" />
            </label>
            <div style={{ ...styles.row, marginTop: 12 }}>
              <button type="button" style={{ ...styles.button, ...disabledStyle(busy || state.setupStatus === 'ready') }} disabled={busy || state.setupStatus === 'ready'} onClick={() => void handleSetup()}>Set up environment</button>
              <button type="button" style={{ ...styles.button, ...disabledStyle(busy || state.setupStatus === 'ready' || !canDownloadModel) }} disabled={busy || state.setupStatus === 'ready' || !canDownloadModel} onClick={() => void handleDownload()}>
                {selectedModelDownloaded ? 'Re-download model' : 'Download model'}
              </button>
              {state.setupStatus !== 'ready' && <button type="button" style={{ ...styles.button, ...disabledStyle(busy || !canStartServer) }} disabled={busy || !canStartServer} onClick={() => void handleStart()}>Start local server</button>}
              {state.setupStatus === 'ready' && <button type="button" style={styles.button} onClick={() => void getMuscriptorService().stop()}>Stop</button>}
            </div>
          </section>

          <section style={styles.section}>
            <div style={{ ...styles.row, justifyContent: 'space-between' }}>
              <div><h3 style={styles.sectionTitle}>Instrument filter</h3><p style={styles.muted}>No selection means auto-detect all instruments.</p></div>
              <button type="button" style={styles.button} disabled={busy} onClick={() => state.setInstruments([])}>Clear filter</button>
            </div>
            <div style={styles.instruments}>
              {instruments.map(instrument => (
                <label key={instrument} style={styles.checkbox}>
                  <input type="checkbox" checked={state.instruments.includes(instrument)} disabled={busy} onChange={() => toggleInstrument(instrument)} />
                  {formatInstrument(instrument)}
                </label>
              ))}
            </div>
          </section>

          {sourceClipId && (
            <section style={styles.section}>
              <h3 style={styles.sectionTitle}>Timeline output</h3>
              <p style={styles.muted}>{resolvedSource ? `Source: ${resolvedSource.audioClip.name}` : 'This clip has no readable audio source.'}</p>
              <div style={{ ...styles.row, marginTop: 12 }}>
                {state.isProcessing
                  ? <button type="button" style={styles.dangerButton} onClick={() => void handleCancel()}>Cancel transcription</button>
                  : <button type="button" style={{ ...styles.primaryButton, ...disabledStyle(state.setupStatus !== 'ready' || !resolvedSource) }} disabled={state.setupStatus !== 'ready' || !resolvedSource} onClick={() => void handleRun()}>Transcribe and create MIDI tracks</button>}
              </div>
            </section>
          )}

          <div style={styles.license}>
            MuScriptor by Kyutai × Mirelo is MIT licensed. Its model weights are <strong>CC BY-NC 4.0</strong> and restricted to non-commercial use.{' '}
            <a href={`https://huggingface.co/MuScriptor/muscriptor-${state.variant}`} target="_blank" rel="noreferrer" style={{ color: '#f1d28b' }}>Open the selected model page to accept its license</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
