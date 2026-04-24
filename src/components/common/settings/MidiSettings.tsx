import { useMIDI } from '../../../hooks/useMIDI';
import {
  describeMIDILearnTarget,
  describeMIDIPermissionState,
  formatMIDINoteBinding,
  getMIDIPermissionHelpText,
  getMIDINoteName,
} from '../../../types/midi';

function formatLastMessage(
  lastMessage: ReturnType<typeof useMIDI>['lastMessage']
): string | null {
  if (!lastMessage) {
    return null;
  }

  if (lastMessage.type === 'note-on' || lastMessage.type === 'note-off') {
    return `Ch ${lastMessage.channel} / ${lastMessage.type === 'note-on' ? 'Note On' : 'Note Off'} / ${lastMessage.noteName ?? getMIDINoteName(lastMessage.note ?? 0)} (${lastMessage.note ?? 0}) / Vel ${lastMessage.velocity ?? 0}`;
  }

  return `Ch ${lastMessage.channel} / CC ${lastMessage.control ?? 0} / Val ${lastMessage.value ?? 0}`;
}

export function MidiSettings() {
  const {
    isSupported,
    isEnabled,
    connectionStatus,
    connectionError,
    permissionState,
    devices,
    lastMessage,
    learnTarget,
    transportBindings,
    enableMIDI,
    disableMIDI,
    startLearningTransportBinding,
    clearTransportBinding,
    cancelLearning,
  } = useMIDI();

  const learnDescription = describeMIDILearnTarget(learnTarget);
  const permissionDescription = describeMIDIPermissionState(permissionState);
  const permissionHelpText = getMIDIPermissionHelpText(permissionState);
  const lastMessageLabel = formatLastMessage(lastMessage);
  const statusText =
    connectionStatus === 'requesting'
      ? 'Requesting MIDI access...'
      : connectionStatus === 'error'
        ? permissionState === 'denied'
          ? 'Browser MIDI permission is blocked for this site.'
          : connectionError || 'Could not connect to MIDI.'
        : devices.length > 0
          ? `${devices.length} device${devices.length > 1 ? 's' : ''} connected`
          : permissionState === 'granted'
            ? 'Permission granted. No devices detected'
            : 'No devices detected';
  const shouldShowConnectionState =
    isEnabled
    || connectionStatus === 'requesting'
    || connectionStatus === 'error'
    || (permissionState !== null && permissionState !== 'unsupported');

  return (
    <div className="settings-category-content">
      <h2>MIDI Control</h2>

      <div className="settings-group">
        <div className="settings-group-title">Overview</div>
        <p className="settings-description">
          Browser MIDI runs directly over the Web MIDI API. Marker-specific bindings are assigned from the marker right-click menu in the timeline.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Connection</div>

        {isSupported ? (
          <>
            <label className="settings-row">
              <span className="settings-label">Enable MIDI</span>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    void enableMIDI();
                  } else {
                    disableMIDI();
                  }
                }}
                className="settings-checkbox"
              />
            </label>

            {shouldShowConnectionState && (
              <>
                <div className="settings-status">
                  <span
                    className={`status-indicator ${connectionStatus === 'connected' && devices.length > 0 ? 'connected' : 'disconnected'}`}
                  />
                  <span className="status-text">
                    {statusText}
                  </span>
                </div>

                {permissionDescription && (
                  <p className="settings-hint">
                    {permissionDescription}
                  </p>
                )}

                {permissionHelpText && (
                  <p className="settings-hint">
                    {permissionHelpText}
                  </p>
                )}

                {devices.length > 0 && (
                  <div className="settings-group" style={{ marginTop: 8 }}>
                    <div className="settings-group-title">Devices</div>
                    {devices.map((device) => (
                      <div key={device.id} className="settings-row">
                        <span className="settings-label">{device.name}</span>
                        <span className="settings-hint" style={{ margin: 0 }}>
                          {device.manufacturer !== 'Unknown' ? device.manufacturer : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {learnDescription && (
                  <div className="midi-learn-status">
                    <span>{learnDescription}</span>
                    <button className="settings-button" onClick={cancelLearning}>
                      Cancel Learn
                    </button>
                  </div>
                )}

                {lastMessageLabel && (
                  <div className="settings-group" style={{ marginTop: 8 }}>
                    <div className="settings-group-title">Last Message</div>
                    <div className="settings-row">
                      <span className="settings-label">{lastMessageLabel}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <p className="settings-hint">
            MIDI is not supported in this browser. Use Chrome or Edge for Web MIDI API support.
          </p>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Transport</div>

        <div className="settings-row">
          <span className="settings-label">Play / Pause</span>
          <div className="settings-row-actions">
            <span className="midi-binding-value">{formatMIDINoteBinding(transportBindings.playPause)}</span>
            <button className="settings-button" onClick={() => startLearningTransportBinding('playPause')}>
              Learn
            </button>
            <button
              className="settings-button"
              onClick={() => clearTransportBinding('playPause')}
              disabled={!transportBindings.playPause}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">Stop</span>
          <div className="settings-row-actions">
            <span className="midi-binding-value">{formatMIDINoteBinding(transportBindings.stop)}</span>
            <button className="settings-button" onClick={() => startLearningTransportBinding('stop')}>
              Learn
            </button>
            <button
              className="settings-button"
              onClick={() => clearTransportBinding('stop')}
              disabled={!transportBindings.stop}
            >
              Clear
            </button>
          </div>
        </div>

        <p className="settings-hint">
          Marker commands are assigned per marker: right-click a timeline marker, then choose Jump To Marker or Play From Marker learning.
        </p>
      </div>
    </div>
  );
}
