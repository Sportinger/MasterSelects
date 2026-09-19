export type ConsumerRequestKind = 'cancellation' | 'withdrawal';

export interface ConsumerRequestBody {
  confirmation: boolean;
  contractReference?: string;
  /** Cancellation only: default is the end of the current billing period. */
  effectiveAt?: 'immediately' | 'period_end';
  email: string;
  locale: 'de' | 'en';
  name: string;
  /** Honeypot field; must stay empty. */
  website?: string;
}

export interface ConsumerRequestResponse {
  duplicate?: boolean;
  kind: ConsumerRequestKind;
  ok: boolean;
  receiptId: string;
  receivedAt: string;
}
