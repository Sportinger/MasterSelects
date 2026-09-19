// Consent block shown before a paid checkout: Terms accepted, Withdrawal Policy
// read, immediate performance requested (§312d, §356 Abs. 4 BGB). Nothing is
// pre-ticked; the checkout button stays disabled until all three are set.

import { LEGAL_PAGE_PATHS } from '../../legal/consumerContractTexts';
import type { LegalLang } from './legal/legalLang';

export interface CheckoutConsentState {
  immediatePerformanceRequested: boolean;
  termsAccepted: boolean;
  withdrawalPolicyRead: boolean;
}

export const EMPTY_CHECKOUT_CONSENT: CheckoutConsentState = {
  immediatePerformanceRequested: false,
  termsAccepted: false,
  withdrawalPolicyRead: false,
};

export function isCheckoutConsentComplete(consent: CheckoutConsentState): boolean {
  return consent.termsAccepted && consent.withdrawalPolicyRead && consent.immediatePerformanceRequested;
}

const COPY = {
  de: {
    cancelLink: 'Verträge hier kündigen',
    immediate: 'Ich verlange ausdrücklich, dass MasterSelects vor Ablauf der 14-tägigen Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf einen anteiligen Betrag für die bereits erbrachte Leistung zahle.',
    termsAfter: ' gelesen und akzeptiere sie.',
    termsBefore: 'Ich habe die ',
    termsLink: 'AGB',
    title: 'Bevor es zu Stripe geht',
    withdrawalAfter: ' zur Kenntnis genommen.',
    withdrawalBefore: 'Ich habe die ',
    withdrawalLink: 'Widerrufsbelehrung',
  },
  en: {
    cancelLink: 'Cancel contracts here',
    immediate: 'I expressly request that MasterSelects begins the service before the 14-day withdrawal period ends. I understand that I pay a proportionate amount for the service already provided if I withdraw.',
    termsAfter: ' and accept them.',
    termsBefore: 'I have read the ',
    termsLink: 'Terms and Conditions',
    title: 'Before you continue to Stripe',
    withdrawalAfter: '.',
    withdrawalBefore: 'I have taken note of the ',
    withdrawalLink: 'Withdrawal Policy',
  },
} as const;

interface CheckoutLegalConsentProps {
  consent: CheckoutConsentState;
  lang: LegalLang;
  onChange: (consent: CheckoutConsentState) => void;
}

export function CheckoutLegalConsent({ consent, lang, onChange }: CheckoutLegalConsentProps) {
  const copy = COPY[lang];
  const toggle = (key: keyof CheckoutConsentState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...consent, [key]: event.target.checked });
  };
  return (
    <section className="pricing-legal-consent" aria-label={copy.title}>
      <h3 className="pricing-legal-consent-title">{copy.title}</h3>
      <label className="pricing-legal-consent-item">
        <input type="checkbox" checked={consent.termsAccepted} onChange={toggle('termsAccepted')} />
        <span>
          {copy.termsBefore}
          <a href={LEGAL_PAGE_PATHS.terms[lang]} target="_blank" rel="noopener noreferrer">{copy.termsLink}</a>
          {copy.termsAfter}
        </span>
      </label>
      <label className="pricing-legal-consent-item">
        <input type="checkbox" checked={consent.withdrawalPolicyRead} onChange={toggle('withdrawalPolicyRead')} />
        <span>
          {copy.withdrawalBefore}
          <a href={LEGAL_PAGE_PATHS.withdrawal[lang]} target="_blank" rel="noopener noreferrer">{copy.withdrawalLink}</a>
          {copy.withdrawalAfter}
        </span>
      </label>
      <label className="pricing-legal-consent-item">
        <input type="checkbox" checked={consent.immediatePerformanceRequested} onChange={toggle('immediatePerformanceRequested')} />
        <span>{copy.immediate}</span>
      </label>
    </section>
  );
}

export function CancellationButtonLink({ lang }: { lang: LegalLang }) {
  return (
    <a className="pricing-cancel-link" href={LEGAL_PAGE_PATHS.cancellation[lang]} target="_blank" rel="noopener noreferrer">
      {COPY[lang].cancelLink}
    </a>
  );
}
