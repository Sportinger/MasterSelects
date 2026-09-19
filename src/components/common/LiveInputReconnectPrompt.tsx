import { useMemo, useState, useSyncExternalStore } from 'react';

import { connectAndPersistLiveInput } from '../../services/mediaRuntime/liveInputConnection';
import { liveInputRuntime } from '../../services/mediaRuntime/liveInputRuntime';
import { useMediaStore } from '../../stores/mediaStore';

function errorMessage(reason: unknown): string {
  if (reason instanceof DOMException && reason.name === 'NotAllowedError') {
    return 'Browser permission was not granted. Display sources require their picker after every reload.';
  }
  return reason instanceof Error ? reason.message : 'A live source could not be reconnected.';
}

export function LiveInputReconnectPrompt() {
  const files = useMediaStore((state) => state.files);
  const updateLiveInputSource = useMediaStore((state) => state.updateLiveInputSource);
  const projectLoadActive = useMediaStore((state) => state.projectLoadProgress.active);
  useSyncExternalStore(
    (listener) => liveInputRuntime.subscribe(listener),
    () => liveInputRuntime.getRevision(),
    () => 0,
  );

  const promptIds = liveInputRuntime.getBulkReconnectPromptIds();
  const items = useMemo(() => promptIds.flatMap((id) => {
    const file = files.find((candidate) => candidate.id === id);
    return file?.liveInput ? [file] : [];
  }), [files, promptIds]);
  const [connecting, setConnecting] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [error, setError] = useState('');

  if (projectLoadActive || items.length === 0) return null;

  const reconnectAll = async () => {
    if (connecting) return;
    setConnecting(true);
    setCompletedCount(0);
    setError('');
    const failures: string[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      try {
        await connectAndPersistLiveInput(item.id, item.liveInput!, updateLiveInputSource);
      } catch (reason) {
        failures.push(`${item.name}: ${errorMessage(reason)}`);
      }
      setCompletedCount(index + 1);
    }

    if (failures.length > 0) setError(failures.join(' '));
    setConnecting(false);
  };

  return (
    <section
      className="live-input-reconnect-prompt"
      role="dialog"
      aria-labelledby="live-input-reconnect-prompt-title"
      aria-describedby="live-input-reconnect-prompt-detail"
    >
      <div className="live-input-reconnect-prompt-copy">
        <strong id="live-input-reconnect-prompt-title">
          {items.length} live {items.length === 1 ? 'source' : 'sources'} offline
        </strong>
        <span id="live-input-reconnect-prompt-detail">
          Reuse the sources saved with this project.
        </span>
      </div>
      <button
        className="live-input-reconnect-prompt-action"
        type="button"
        disabled={connecting}
        onClick={() => { void reconnectAll(); }}
      >
        {connecting
          ? `Reconnecting ${completedCount}/${items.length}…`
          : 'Reconnect all live sources'}
      </button>
      <button
        className="live-input-reconnect-prompt-close"
        type="button"
        aria-label="Dismiss live source reconnect reminder"
        disabled={connecting}
        onClick={() => liveInputRuntime.dismissBulkReconnectPrompt()}
      >
        ×
      </button>
      {error && <p className="live-input-reconnect-prompt-error" role="alert">{error}</p>}
    </section>
  );
}
