// "Recent project loads" section of the phone Diagnostics page (see phoneProjectLoads.ts).
import type { PhoneLoadRow } from './phoneProjectLoads';
import { PHONE_SETTINGS_TEST_IDS as IDS } from './phoneSettingsTestIds';

export function PhoneRecentLoads({ rows }: { rows: readonly PhoneLoadRow[] }) {
  return (
    <section aria-label="Recent project loads" data-testid={IDS.recentLoads} data-count={rows.length}>
      <h3 className="phone-lib__section">Recent project loads</h3>
      {rows.length === 0 ? (
        <p className="phone-lib__note">No project was opened, created or saved since this page loaded.</p>
      ) : (
        <ol className="phone-settings__loads">
          {rows.map((row) => (
            <li key={row.key} className="phone-settings__load" data-testid={IDS.recentLoad} data-outcome={row.outcome} data-slow={row.slow}>
              <div className="phone-settings__load-head">
                <span>{row.title}{row.outcome === 'ready' ? '' : ` · ${row.outcome}`}</span>
                <strong className={row.slow ? 'is-slow' : undefined}>{row.total}</strong>
              </div>
              <dl className="phone-settings__load-phases">
                {row.phases.map((phase) => (
                  <div key={phase.phase} className="phone-settings__load-phase" data-phase={phase.phase}>
                    <dt>{phase.label}</dt>
                    <dd className={phase.slow ? 'is-slow' : undefined}>{phase.seconds}</dd>
                  </div>
                ))}
                {row.firstFrame ? (
                  <div className="phone-settings__load-phase" data-phase="first_frame">
                    <dt>First frame after loading</dt>
                    <dd>{row.firstFrame}</dd>
                  </div>
                ) : null}
                {row.frameGap ? (
                  <div className="phone-settings__load-phase" data-phase="frame_gap">
                    <dt>Longest screen freeze</dt>
                    <dd>{row.frameGap}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
