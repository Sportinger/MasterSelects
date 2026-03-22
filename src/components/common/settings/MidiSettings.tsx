import { useMIDI } from '../../../hooks/useMIDI';

export function MidiSettings() {
  const { isSupported, isEnabled, devices, lastMessage, enableMIDI, disableMIDI } = useMIDI();

  return (
    <div className="settings-category-content">
      <h2>MIDI Control</h2>

      <div className="settings-group">
        <div className="settings-group-title">Connection</div>

        {isSupported ? (
          <>
            <label className="settings-row">
              <span className="settings-label">Enable MIDI</span>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => { if (e.target.checked) enableMIDI(); else disableMIDI(); }}
                className="settings-checkbox"
              />
            </label>

            {isEnabled && (
              <>
                <div className="settings-status">
                  <span className={`status-indicator ${devices.length > 0 ? 'connected' : 'disconnected'}`} />
                  <span className="status-text">
                    {devices.length > 0
                      ? `${devices.length} device${devices.length > 1 ? 's' : ''} connected`
                      : 'No devices detected'}
                  </span>
                </div>

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

                {lastMessage && (
                  <div className="settings-group" style={{ marginTop: 8 }}>
                    <div className="settings-group-title">Last Message</div>
                    <div className="settings-row">
                      <span className="settings-label">
                        CH {lastMessage.channel} / CC {lastMessage.control} / Val {lastMessage.value}
                      </span>
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

      <p className="settings-hint">
        MIDI mappings for timeline and effect parameters will be available in a future update.
      </p>
    </div>
  );
}
