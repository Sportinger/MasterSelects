// Card at the top of the phone home when the last folder project waits for folder access again
// (Chrome keeps folder grants only per browsing session). One tap asks the browser and reopens it.
import { PHONE_HOME_TEST_IDS } from './phoneHomeTestIds';

interface PhoneHomeResumeCardProps {
  name: string;
  busy: boolean;
  onReopen: () => void;
}

export function PhoneHomeResumeCard({ name, busy, onReopen }: PhoneHomeResumeCardProps) {
  return (
    <section className="phone-home__resume" aria-label="Reopen last project" data-testid={PHONE_HOME_TEST_IDS.resumeCard} data-project-name={name}>
      <p className="phone-home__resume-label">Last project</p>
      <p className="phone-home__resume-name">{name}</p>
      <p className="phone-home__resume-text">The browser asks for folder access again after a restart. Your project is unchanged.</p>
      <button
        type="button"
        className="phone-home__button phone-home__button--primary phone-home__resume-button"
        aria-disabled={busy}
        data-testid={PHONE_HOME_TEST_IDS.resume}
        onClick={onReopen}
      >
        {busy ? 'Reopening…' : `Reopen ${name} · allow folder access`}
      </button>
    </section>
  );
}
