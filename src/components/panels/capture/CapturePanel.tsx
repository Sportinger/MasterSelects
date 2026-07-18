import { useCallback, useEffect, useState } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { createNewProject } from '../../../services/projectSync';
import { screenCaptureService } from '../../../services/capture/ScreenCaptureService';
import { commitCaptureRecording } from '../../../services/capture/recording/commitRecording';
import { createCaptureAudioMix } from '../../../services/capture/recording/audioMixing';
import {
  ArtifactCaptureRecordingBlobStore,
  deleteCaptureRecoveryEntry,
  getCaptureRecoveryStorage,
  readCaptureRecoveryEntries,
} from '../../../services/capture/recording/recoveryPersistence';
import {
  acquireDisplaySource,
  watchDisplaySourceEnded,
  type PreferredCaptureSurface,
} from '../../../services/capture/sourceAcquisition';
import { commitRecoveredCaptureRecording } from '../../../services/capture/captureRecordingWorkflow';
import { useUiSettingsStore } from '../../../stores/uiSettingsStore';
import { CaptureControls } from './CaptureControls';
import { CapturePreview } from './CapturePreview';
import { CAPTURE_BITRATES, CaptureSettings } from './CaptureSettings';
import { flags } from '../../../engine/featureFlags';
import type { CaptureCropRect, CaptureOutputScale } from '../../../services/capture/recording/frameTransform';
import './CapturePanel.css';

export function CapturePanel() {
  const [snapshot, setSnapshot] = useState(() => screenCaptureService.getSnapshot());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [projectOpen, setProjectOpen] = useState(() => projectFileService.isProjectOpen());
  const [recoveryEntries, setRecoveryEntries] = useState(() => readCaptureRecoveryEntries(getCaptureRecoveryStorage()));
  const [crop, setCrop] = useState<CaptureCropRect>();
  const captureSettings = useUiSettingsStore();

  useEffect(() => screenCaptureService.subscribe(setSnapshot), []);
  const refreshRecovery = useCallback(() => {
    const storage = getCaptureRecoveryStorage();
    const entries = readCaptureRecoveryEntries(storage);
    const blobStore = new ArtifactCaptureRecordingBlobStore();
    for (const entry of entries) {
      if (entry.status === 'committed') void deleteCaptureRecoveryEntry(storage, blobStore, entry.sessionId);
    }
    setRecoveryEntries(entries.filter(entry => entry.status !== 'committed' && entry.sessionId !== snapshot.sessionId));
  }, [snapshot.sessionId]);
  useEffect(() => {
    const timer = window.setTimeout(refreshRecovery, 0);
    return () => window.clearTimeout(timer);
  }, [refreshRecovery]);

  const finishRecording = useCallback(async (result: Awaited<ReturnType<typeof screenCaptureService.stop>>) => {
    const committed = await commitCaptureRecording(result, {
      placeOnTimeline: captureSettings.captureAutoPlaceOnTimeline,
    });
    setResultMessage(`Imported ${committed.fileName} into Recordings.`);
    refreshRecovery();
  }, [captureSettings.captureAutoPlaceOnTimeline, refreshRecovery]);

  const handleSourceEnded = useCallback(() => {
    void screenCaptureService.handleSourceLost().then(result => {
      if (result) return finishRecording(result);
      return undefined;
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Screen sharing stopped unexpectedly.'));
  }, [finishRecording]);

  const selectSource = useCallback((preferredSurface: PreferredCaptureSurface) => {
    setError(null);
    setResultMessage(null);
    screenCaptureService.beginSourceSelection();
    const acquisition = acquireDisplaySource({
      preferredSurface,
      includeAudio: captureSettings.captureDisplayAudioEnabled,
      includeCursor: captureSettings.captureCursorEnabled,
      muteCapturedTab: captureSettings.captureMuteCapturedTab,
    });
    setBusy(true);
    void acquisition.then(async acquired => {
      let audioMix;
      try {
        audioMix = await createCaptureAudioMix({
          displayStream: acquired.runtime.stream,
          includeDisplayAudio: captureSettings.captureDisplayAudioEnabled,
          includeMicrophone: captureSettings.captureMicrophoneEnabled,
          microphoneDeviceId: captureSettings.audioInputDeviceId || undefined,
        });
      } catch (cause) {
        acquired.runtime.stream.getTracks().forEach(track => track.stop());
        throw cause;
      }
      const stopWatching = watchDisplaySourceEnded(acquired.runtime.stream, handleSourceEnded);
      screenCaptureService.attachSource({
        stream: audioMix.recordingStream,
        getAudioLevels: audioMix.getLevels,
        release: async () => {
          stopWatching();
          await audioMix.close();
          acquired.runtime.stream.getTracks().forEach(track => track.stop());
        },
      }, { ...acquired.snapshot, hasMicrophoneAudio: audioMix.hasMicrophoneAudio });
    }).catch(async cause => {
      await screenCaptureService.cancel();
      setError(cause instanceof Error ? cause.message : 'The capture source could not be opened.');
    }).finally(() => setBusy(false));
  }, [captureSettings, handleSourceEnded]);

  const run = useCallback((action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void action().catch(cause => {
      setError(cause instanceof Error ? cause.message : 'Screen capture failed.');
    }).finally(() => setBusy(false));
  }, []);

  const start = () => run(async () => {
    if (!projectFileService.isProjectOpen()) {
      setProjectOpen(false);
      throw new Error('Open or create a project before recording the screen.');
    }
    const useWebCodecs = flags.screenCaptureWebCodecs
      && typeof globalThis.VideoEncoder !== 'undefined'
      && 'MediaStreamTrackProcessor' in globalThis;
    const scale: CaptureOutputScale = captureSettings.captureScalePreset === '75'
      ? 0.75
      : captureSettings.captureScalePreset === '50'
        ? 0.5
        : captureSettings.captureScalePreset === '1080p'
          ? '1080p'
          : 1;
    await screenCaptureService.start({
      tier: useWebCodecs ? 'webcodecs' : 'media-recorder',
      fps: captureSettings.captureFps,
      bitrateBitsPerSecond: CAPTURE_BITRATES[captureSettings.captureBitratePreset],
      audioBitrateBitsPerSecond: 192_000,
      crop: useWebCodecs ? crop : undefined,
      scale: useWebCodecs ? scale : 1,
    });
  });
  const stop = () => run(async () => finishRecording(await screenCaptureService.stop()));

  const dismissRecovery = (sessionId: string) => run(async () => {
    await deleteCaptureRecoveryEntry(getCaptureRecoveryStorage(), new ArtifactCaptureRecordingBlobStore(), sessionId);
    refreshRecovery();
  });
  const restoreRecovery = (sessionId: string) => run(async () => {
    const committed = await commitRecoveredCaptureRecording(sessionId, {
      placeOnTimeline: captureSettings.captureAutoPlaceOnTimeline,
    });
    setResultMessage(`Restored ${committed.fileName} into Recordings.`);
    refreshRecovery();
  });

  const bitrate = CAPTURE_BITRATES[captureSettings.captureBitratePreset];
  const canChooseSource = snapshot.phase === 'idle' || snapshot.phase === 'complete' || snapshot.phase === 'error';

  return (
    <div className="capture-panel">
      <header className="panel-header capture-panel-header">
        <div>
          <h2>Screen Capture</h2>
          <p>Record a display, window, or browser tab directly into your project.</p>
        </div>
        <span className={`capture-phase capture-phase-${snapshot.phase}`}>{snapshot.phase.replaceAll('-', ' ')}</span>
      </header>
      {!projectOpen && (
        <div className="capture-project-callout">
          <p>A project is required so the recording can be copied into RAW.</p>
          <button className="btn btn-active" type="button" onClick={() => run(async () => {
            const name = window.prompt('Project name', 'Screen Capture')?.trim();
            if (name) setProjectOpen(await createNewProject(name));
          })}>Create project</button>
        </div>
      )}
      <section className="capture-source-section">
        <div className="capture-section-heading">
          <span>Choose source</span>
          <small>The browser picker makes the final selection</small>
        </div>
        <div className="capture-source-grid" aria-label="Capture source preference">
          <button className="btn" type="button" disabled={!canChooseSource || busy} onClick={() => selectSource('monitor')}>
            <strong>Screen</strong><span>Entire display</span>
          </button>
          <button className="btn" type="button" disabled={!canChooseSource || busy} onClick={() => selectSource('window')}>
            <strong>Window</strong><span>One application</span>
          </button>
          <button className="btn" type="button" disabled={!canChooseSource || busy} onClick={() => selectSource('browser')}>
            <strong>Browser tab</strong><span>Best for tab audio</span>
          </button>
        </div>
      </section>
      <div className="capture-workspace">
        <div className="capture-preview-column">
          <div className="capture-section-heading"><span>Preview</span></div>
          <CapturePreview
            stream={screenCaptureService.getPreviewStream()}
            snapshot={snapshot}
            crop={crop}
            cropEnabled={snapshot.phase === 'previewing' && flags.screenCaptureWebCodecs}
            onCropChange={setCrop}
          />
        </div>
        <CaptureSettings snapshot={snapshot} />
      </div>
      <CaptureControls
        snapshot={snapshot}
        busy={busy}
        error={error}
        resultMessage={resultMessage}
        estimatedBytesPerSecond={(bitrate + 192_000) / 8}
        recoveryEntries={recoveryEntries}
        onStart={start}
        onPause={() => run(() => screenCaptureService.pause())}
        onResume={() => run(() => screenCaptureService.resume())}
        onStop={stop}
        onCancelPreview={() => run(() => screenCaptureService.cancel())}
        onRestore={restoreRecovery}
        onDismiss={dismissRecovery}
      />
      <p className="capture-footnote">Compatibility recordings use browser-native WebM/MP4. Crop and scale are available in the experimental WebCodecs tier.</p>
    </div>
  );
}
