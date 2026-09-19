import { useMemo, useSyncExternalStore } from 'react';
import {
  getStreamHealthHistory,
  subscribeStreamHealthHistory,
} from '../../../services/liveStream/streamHealthHistory';
import type { StreamStoreApi } from '../../../services/liveStream/streamTypes';
import { Logger } from '../../../services/logger';
import { useStreamStore } from '../../../stores/streamStore';
import { HealthGraphCanvas } from './HealthGraphCanvas';
import { PlatformStatsSection } from './PlatformStatsSection';
import './StreamAnalyticsPanel.css';

const log = Logger.create('StreamAnalyticsPanel');

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTransport(transport: 'rtmp' | 'whip', relay: 'helper' | 'cloud' | null): string {
  return `${transport.toUpperCase()} · ${relay ?? 'direct'}`;
}

export function StreamAnalyticsPanel() {
  const status = useStreamStore((state: StreamStoreApi) => state.status);
  const sessionLog = useStreamStore((state: StreamStoreApi) => state.sessionLog);
  const clearSessionLog = useStreamStore((state: StreamStoreApi) => state.clearSessionLog);
  const history = useSyncExternalStore(
    subscribeStreamHealthHistory,
    getStreamHealthHistory,
    getStreamHealthHistory,
  );

  const droppedPerSecond = useMemo(() => history.map((sample, index) => (
    index === 0 ? 0 : Math.max(0, sample.droppedFrames - history[index - 1].droppedFrames)
  )), [history]);
  const newestSessions = useMemo(
    () => sessionLog.toSorted((left, right) => right.startedAtMs - left.startedAtMs),
    [sessionLog],
  );
  const bitrateLines = useMemo(() => [{
    label: 'Bitrate',
    colorProperty: '--stream-graph-bitrate',
    values: history.map(sample => sample.bitrateKbps),
  }], [history]);
  const droppedLines = useMemo(() => [{
    label: 'Dropped frames/s',
    colorProperty: '--stream-graph-drops',
    values: droppedPerSecond,
  }], [droppedPerSecond]);
  const audioLines = useMemo(() => [
    {
      label: 'Program',
      colorProperty: '--stream-graph-program',
      values: history.map(sample => sample.audioProgram),
    },
    {
      label: 'Microphone',
      colorProperty: '--stream-graph-microphone',
      values: history.map(sample => sample.audioMicrophone),
    },
  ], [history]);

  return (
    <div className="stream-analytics-panel">
      <header className="panel-header stream-analytics-header">
        <div>
          <h2>Stream Analytics</h2>
          <p>Live transport health and recent stream sessions.</p>
        </div>
      </header>

      <section className="stream-analytics-section" aria-labelledby="stream-analytics-live-heading">
        <h3 id="stream-analytics-live-heading">Live</h3>
        {status.phase === 'live' ? (
          <div className="stream-analytics-live-grid" aria-label="Current stream health">
            <div><small>Uptime</small><strong>{formatDuration(status.stats.uptimeSeconds)}</strong></div>
            <div><small>Bitrate</small><strong>{Math.round(status.stats.bitrateKbpsEstimate)} kbps</strong></div>
            <div><small>Dropped</small><strong>{status.stats.droppedFrames}</strong></div>
            <div><small>Relay</small><strong>{status.activeRtmpRelay ?? 'direct'}</strong></div>
          </div>
        ) : (
          <p className="stream-analytics-quiet">Not streaming. Live health data will appear here.</p>
        )}
      </section>

      <PlatformStatsSection />

      <section className="stream-analytics-section stream-analytics-graphs" aria-labelledby="stream-analytics-graphs-heading">
        <h3 id="stream-analytics-graphs-heading">Graphs</h3>
        <article className="stream-analytics-graph">
          <div className="stream-analytics-graph-title"><span>Bitrate</span><span>kbps</span></div>
          <HealthGraphCanvas label="Bitrate history" samples={history} lines={bitrateLines} rangeFloor={100} formatValue={value => `${Math.round(value)}`} />
        </article>
        <article className="stream-analytics-graph">
          <div className="stream-analytics-graph-title"><span>Dropped frames</span><span>per second</span></div>
          <HealthGraphCanvas label="Dropped frames per second history" samples={history} lines={droppedLines} rangeFloor={1} formatValue={value => `${Math.round(value)}`} />
        </article>
        <article className="stream-analytics-graph">
          <div className="stream-analytics-graph-title">
            <span>Audio levels</span>
            <span className="stream-analytics-legend"><i />Program <i className="microphone" />Mic</span>
          </div>
          <HealthGraphCanvas label="Program and microphone audio level history" samples={history} lines={audioLines} rangeFloor={0.1} formatValue={value => value.toFixed(1)} />
        </article>
      </section>

      <section className="stream-analytics-section stream-analytics-sessions" aria-labelledby="stream-analytics-sessions-heading">
        <div className="stream-analytics-section-heading">
          <h3 id="stream-analytics-sessions-heading">Sessions</h3>
          <button
            type="button"
            className="btn stream-analytics-clear"
            disabled={sessionLog.length === 0}
            onClick={() => {
              clearSessionLog();
              log.info('Stream session log cleared');
            }}
          >
            Clear log
          </button>
        </div>
        {newestSessions.length === 0 ? (
          <p className="stream-analytics-quiet">No completed stream sessions yet.</p>
        ) : (
          <div className="stream-analytics-table-wrap">
            <table>
              <thead>
                <tr><th>Started</th><th>Duration</th><th>Transport</th><th>Ø bitrate</th><th>Drops</th><th>Status</th></tr>
              </thead>
              <tbody>
                {newestSessions.map((entry, index) => (
                  <tr key={`${entry.startedAtMs}-${index}`}>
                    <td>{new Date(entry.startedAtMs).toLocaleString()}</td>
                    <td>{formatDuration(entry.durationSeconds)}</td>
                    <td>{formatTransport(entry.transport, entry.relay)}</td>
                    <td>{Math.round(entry.avgBitrateKbps)} kbps</td>
                    <td>{entry.droppedFrames}</td>
                    <td>
                      <span
                        className={`stream-analytics-result stream-analytics-result-${entry.endReason}`}
                        title={entry.endReason === 'error' ? entry.errorMessage : undefined}
                      >
                        {entry.endReason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
