// Terms, Withdrawal Policy (with the online withdrawal form), and the
// cancellation button page (§312k BGB) shown inside the legal dialog and on
// /agb, /widerruf, /kuendigen (and their English aliases).

import { useState, type FormEvent } from 'react';
import {
  CANCELLATION_TEXT_DE,
  CANCELLATION_TEXT_EN,
  LEGAL_PAGE_PATHS,
  TERMS_TEXT_DE,
  TERMS_TEXT_EN,
  WITHDRAWAL_TEXT_DE,
  WITHDRAWAL_TEXT_EN,
} from '../../../legal/consumerContractTexts';
import type { ConsumerRequestKind } from '../../../legal/consumerRequestTypes';
import { cloudApi } from '../../../services/cloudApi';
import { useAccountStore } from '../../../stores/accountStore';
import { LegalPlainText } from './LegalPlainText';
import type { LegalLang } from './legalLang';

interface AccountUserLike {
  displayName?: string | null;
  email?: string | null;
}

const FORM_COPY = {
  de: {
    cancellation: {
      confirm: 'Ich kündige hiermit mein MasterSelects-Abonnement.',
      effectiveImmediately: 'So früh wie möglich',
      effectivePeriodEnd: 'Zum Ende des laufenden Abrechnungszeitraums (Standard)',
      effectiveTitle: 'Gewünschter Zeitpunkt',
      heading: 'Verträge hier kündigen',
      submit: 'Jetzt kündigen',
      success: 'Ihre Kündigung ist eingegangen. Sie erhalten die Eingangsbestätigung mit Datum und Uhrzeit per E-Mail.',
    },
    duplicate: 'Für diese E-Mail-Adresse liegt bereits eine Erklärung aus den letzten 24 Stunden vor. Ihre Vorgangsnummer:',
    email: 'E-Mail-Adresse (wie beim Kauf)',
    error: 'Die Erklärung konnte nicht übermittelt werden. Bitte versuchen Sie es erneut oder schreiben Sie an admin@masterselects.com.',
    name: 'Vor- und Nachname',
    receipt: 'Vorgangsnummer',
    reference: 'Rechnungs- oder Vertragsnummer (optional)',
    referenceHint: 'Zum Beispiel die Stripe-Rechnungsnummer oder das Bestelldatum. Ohne Angabe ordnen wir den Vertrag über die E-Mail-Adresse zu.',
    required: 'Bitte Name, E-Mail-Adresse und Bestätigung ausfüllen.',
    submitting: 'Wird übermittelt …',
    withdrawal: {
      confirm: 'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über das MasterSelects-Abonnement.',
      heading: 'Online-Widerruf',
      submit: 'Widerruf absenden',
      success: 'Ihr Widerruf ist eingegangen. Sie erhalten eine Bestätigung per E-Mail.',
    },
  },
  en: {
    cancellation: {
      confirm: 'I hereby cancel my MasterSelects subscription.',
      effectiveImmediately: 'As early as possible',
      effectivePeriodEnd: 'At the end of the current billing period (default)',
      effectiveTitle: 'Requested date',
      heading: 'Cancel contracts here',
      submit: 'Cancel now',
      success: 'Your cancellation has been received. The receipt with date and time is on its way to your inbox.',
    },
    duplicate: 'A notice for this email address was already received within the last 24 hours. Your receipt number:',
    email: 'Email address (as used at purchase)',
    error: 'The notice could not be submitted. Please try again or write to admin@masterselects.com.',
    name: 'First and last name',
    receipt: 'Receipt number',
    reference: 'Invoice or contract reference (optional)',
    referenceHint: 'For example the Stripe invoice number or the order date. Without it we match the contract by email address.',
    required: 'Please fill in name, email address, and the confirmation.',
    submitting: 'Submitting …',
    withdrawal: {
      confirm: 'I hereby withdraw from my contract for the MasterSelects subscription.',
      heading: 'Online withdrawal',
      submit: 'Send withdrawal',
      success: 'Your withdrawal has been received. A confirmation is on its way to your inbox.',
    },
  },
} as const;

interface ConsumerRequestFormProps {
  kind: ConsumerRequestKind;
  lang: LegalLang;
}

export function ConsumerRequestForm({ kind, lang }: ConsumerRequestFormProps) {
  const user = useAccountStore((state) => state.user as AccountUserLike | null);
  const copy = FORM_COPY[lang];
  const kindCopy = copy[kind];
  const [name, setName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [contractReference, setContractReference] = useState('');
  const [effectiveAt, setEffectiveAt] = useState<'immediately' | 'period_end'>('period_end');
  const [confirmation, setConfirmation] = useState(false);
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ duplicate: boolean; receiptId: string; receivedAt: string } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'submitting') return;
    if (!name.trim() || !email.trim() || !confirmation) {
      setError(copy.required);
      return;
    }
    setStatus('submitting');
    setError(null);
    try {
      const response = await cloudApi.legal.submitRequest(kind, {
        confirmation,
        contractReference: contractReference.trim() || undefined,
        effectiveAt: kind === 'cancellation' ? effectiveAt : undefined,
        email: email.trim(),
        locale: lang,
        name: name.trim(),
        website,
      });
      setResult({ duplicate: response.duplicate === true, receiptId: response.receiptId, receivedAt: response.receivedAt });
      setStatus('done');
    } catch (submitError) {
      setStatus('idle');
      setError(submitError instanceof Error && submitError.message ? submitError.message : copy.error);
    }
  };

  if (status === 'done' && result) {
    const received = new Date(result.receivedAt);
    return (
      <div className="legal-form legal-form-success" role="status">
        <h4>{kindCopy.heading}</h4>
        <p>{result.duplicate ? copy.duplicate : kindCopy.success}</p>
        <p className="legal-form-receipt">
          <strong>{copy.receipt}:</strong> {result.receiptId}
          <br />
          {Number.isNaN(received.getTime()) ? result.receivedAt : received.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}
        </p>
      </div>
    );
  }

  const idPrefix = `legal-${kind}`;
  return (
    <form className="legal-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h4>{kindCopy.heading}</h4>
      <label className="legal-form-field" htmlFor={`${idPrefix}-name`}>
        <span>{copy.name}</span>
        <input id={`${idPrefix}-name`} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="legal-form-field" htmlFor={`${idPrefix}-email`}>
        <span>{copy.email}</span>
        <input id={`${idPrefix}-email`} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="legal-form-field" htmlFor={`${idPrefix}-reference`}>
        <span>{copy.reference}</span>
        <input id={`${idPrefix}-reference`} value={contractReference} onChange={(event) => setContractReference(event.target.value)} />
        <small>{copy.referenceHint}</small>
      </label>
      {kind === 'cancellation' && (
        <fieldset className="legal-form-fieldset">
          <legend>{copy.cancellation.effectiveTitle}</legend>
          <label className="legal-form-choice">
            <input type="radio" name={`${idPrefix}-effective`} checked={effectiveAt === 'period_end'} onChange={() => setEffectiveAt('period_end')} />
            <span>{copy.cancellation.effectivePeriodEnd}</span>
          </label>
          <label className="legal-form-choice">
            <input type="radio" name={`${idPrefix}-effective`} checked={effectiveAt === 'immediately'} onChange={() => setEffectiveAt('immediately')} />
            <span>{copy.cancellation.effectiveImmediately}</span>
          </label>
        </fieldset>
      )}
      <label className="legal-form-choice legal-form-confirm">
        <input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} />
        <span>{kindCopy.confirm}</span>
      </label>
      <div className="legal-form-honeypot" aria-hidden="true">
        <label htmlFor={`${idPrefix}-website`}>Website</label>
        <input id={`${idPrefix}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </div>
      {error && <p className="legal-form-error" role="alert">{error}</p>}
      <button
        className="auth-dialog-submit legal-form-submit"
        disabled={status === 'submitting'}
        onPointerUp={(event) => event.currentTarget.blur()}
        type="submit"
      >
        {status === 'submitting' ? copy.submitting : kindCopy.submit}
      </button>
    </form>
  );
}

export function TermsPage({ lang }: { lang: LegalLang }) {
  return (
    <>
      <LegalPlainText text={lang === 'de' ? TERMS_TEXT_DE : TERMS_TEXT_EN} />
      <p className="legal-text legal-meta">
        {lang === 'de'
          ? <>Widerruf: <a href={LEGAL_PAGE_PATHS.withdrawal.de}>{LEGAL_PAGE_PATHS.withdrawal.de}</a> · Kündigung: <a href={LEGAL_PAGE_PATHS.cancellation.de}>{LEGAL_PAGE_PATHS.cancellation.de}</a></>
          : <>Withdrawal: <a href={LEGAL_PAGE_PATHS.withdrawal.en}>{LEGAL_PAGE_PATHS.withdrawal.en}</a> · Cancellation: <a href={LEGAL_PAGE_PATHS.cancellation.en}>{LEGAL_PAGE_PATHS.cancellation.en}</a></>}
      </p>
    </>
  );
}

export function WithdrawalPage({ lang }: { lang: LegalLang }) {
  return (
    <>
      <LegalPlainText text={lang === 'de' ? WITHDRAWAL_TEXT_DE : WITHDRAWAL_TEXT_EN} />
      <ConsumerRequestForm kind="withdrawal" lang={lang} />
    </>
  );
}

export function CancellationPage({ lang }: { lang: LegalLang }) {
  return (
    <>
      <LegalPlainText text={lang === 'de' ? CANCELLATION_TEXT_DE : CANCELLATION_TEXT_EN} />
      <ConsumerRequestForm kind="cancellation" lang={lang} />
    </>
  );
}
