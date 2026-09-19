// Consumer-contract texts shared by the browser (/agb, /widerruf, /kuendigen,
// checkout consent) and the Pages Functions (contract confirmation email).
// Bump the version constants whenever a text changes: the checkout rejects
// consents that reference an older version.

export const TERMS_VERSION = '2026-09-02';
export const WITHDRAWAL_VERSION = '2026-09-02';

export const BUSINESS_NAME = 'Jan Roman Kuskowski';
export const BUSINESS_ADDRESS = 'c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, Germany';
export const BUSINESS_EMAIL = 'admin@masterselects.com';
export const BUSINESS_PHONE = '0151 51484895';

export const LEGAL_PAGE_PATHS = {
  cancellation: { de: '/kuendigen', en: '/cancel' },
  terms: { de: '/agb', en: '/terms' },
  withdrawal: { de: '/widerruf', en: '/withdrawal' },
} as const;

export const TERMS_TEXT_DE = `Allgemeine Geschäftsbedingungen (AGB) – MasterSelects
Stand: 2. September 2026

1. Anbieter und Geltung
Vertragspartner ist Jan Roman Kuskowski, c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, Deutschland, E-Mail: admin@masterselects.com, Telefon: 0151 51484895. Diese AGB gelten für kostenpflichtige MasterSelects-Abonnements und die damit verbundenen Cloud- und KI-Dienste.

2. Leistung
MasterSelects ist ein browserbasierter Videoeditor. Kostenpflichtige Tarife stellen während der Vertragslaufzeit das im Checkout bezeichnete monatliche Credit-Kontingent und die dort genannten Funktionen bereit. Cloud- und KI-Ergebnisse können technisch und inhaltlich variieren. Wartung, Sicherheitsmaßnahmen und notwendige Änderungen dürfen die Verfügbarkeit vorübergehend einschränken.

3. Vertragsschluss
Die Tarifdarstellung ist eine Aufforderung zur Abgabe eines Angebots. Vor Weiterleitung zu Stripe wählt der Kunde den Tarif und bestätigt AGB, Widerrufsbelehrung sowie den Wunsch nach sofortigem Leistungsbeginn. Mit dem abschließenden, eindeutig zahlungspflichtig beschrifteten Button bei Stripe gibt der Kunde ein verbindliches Angebot ab. Die Annahme erfolgt durch die Bestätigungsmail oder die Freischaltung des Tarifs.

4. Preise und Zahlung
Maßgeblich sind Gesamtpreis, Steuern und Abrechnungsintervall, die unmittelbar vor der zahlungspflichtigen Bestellung bei Stripe angezeigt werden. Die Zahlung wird über Stripe abgewickelt; MasterSelects speichert keine vollständigen Karten- oder Bankdaten.

5. Laufzeit, Verlängerung und Kündigung
Kostenpflichtige Tarife laufen monatlich und verlängern sich jeweils um einen weiteren Monat, bis sie gekündigt werden. Die Kündigung ist jederzeit über das Billing-Portal oder über die Kündigungsschaltfläche unter https://masterselects.com/kuendigen möglich und wird grundsätzlich zum Ende des laufenden Abrechnungszeitraums wirksam. Der Eingang einer Kündigung wird unverzüglich elektronisch bestätigt. Gesetzliche außerordentliche Kündigungsrechte bleiben unberührt.

6. Credits
Credits sind nutzungsgebundene Rechnungseinheiten für ausgewiesene Cloud- und KI-Funktionen, nicht übertragbar und nicht in Geld auszahlbar. Der konkrete Credit-Verbrauch wird vor oder bei Nutzung der jeweiligen Funktion ausgewiesen. Gesetzliche Rückzahlungs- und Gewährleistungsrechte bleiben unberührt.

7. Kundenpflichten
Zugangsdaten sind vertraulich zu behandeln. MasterSelects darf nicht rechtswidrig, missbräuchlich oder zur Verletzung von Rechten Dritter genutzt werden. Der Kunde muss über die erforderlichen Rechte an hochgeladenen Inhalten verfügen.

8. Nutzungsrechte
Für die Vertragsdauer erhält der Kunde ein einfaches, nicht übertragbares Recht zur vertragsgemäßen Nutzung. Rechte an eigenen Inhalten verbleiben beim Kunden; er räumt nur die zur technischen Verarbeitung der von ihm gestarteten Funktionen erforderlichen Rechte ein.

9. Gewährleistung und Haftung
Es gelten die gesetzlichen Mängelrechte. MasterSelects haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz sowie bei übernommenen Garantien. Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vorhersehbaren, vertragstypischen Schaden begrenzt; im Übrigen ist sie bei leichter Fahrlässigkeit ausgeschlossen.

10. Widerruf
Verbrauchern steht das gesetzliche Widerrufsrecht nach der gesonderten Widerrufsbelehrung zu. Der Online-Widerruf ist unter https://masterselects.com/widerruf möglich.

11. Änderungen
Änderungen gelten nur für die Zukunft. Bei wesentlichen Änderungen laufender Verträge wird rechtzeitig informiert; zwingende Verbraucherrechte und ein gegebenenfalls bestehendes Kündigungsrecht bleiben unberührt.

12. Recht und Streitbeilegung
Es gilt deutsches Recht unter Wahrung zwingender Verbraucherschutzvorschriften des Staates des gewöhnlichen Aufenthalts. MasterSelects ist nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.`;

export const WITHDRAWAL_TEXT_DE = `Widerrufsbelehrung – MasterSelects
Stand: 2. September 2026

Widerrufsrecht
Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschlusses.

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns – Jan Roman Kuskowski, c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, Deutschland, E-Mail: admin@masterselects.com, Telefon: 0151 51484895 – mittels einer eindeutigen Erklärung (zum Beispiel ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können außerdem die hervorgehobene Online-Widerrufsfunktion unter https://masterselects.com/widerruf verwenden.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

Folgen des Widerrufs
Wenn Sie diesen Vertrag widerrufen, erstatten wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag, an dem die Mitteilung über Ihren Widerruf bei uns eingegangen ist. Für die Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, sofern nicht ausdrücklich etwas anderes vereinbart wurde. Ihnen werden wegen dieser Rückzahlung keine Entgelte berechnet.

Haben Sie verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der vertraglich vorgesehenen Dienstleistungen entspricht.

Muster-Widerrufsformular
Wenn Sie den Vertrag widerrufen wollen, können Sie folgende Angaben übermitteln:
– An: Jan Roman Kuskowski, c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, admin@masterselects.com
– Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung: MasterSelects-Abonnement
– Bestellt am:
– Name:
– Anschrift:
– Datum (und Unterschrift nur bei Mitteilung auf Papier)`;

export const TERMS_TEXT_EN = `MasterSelects Terms and Conditions
Version: September 2, 2026

Provider: Jan Roman Kuskowski, c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, Germany; admin@masterselects.com; 0151 51484895.

MasterSelects is a browser-based video editor. Paid monthly subscriptions provide the credit allowance and features displayed at checkout. The customer selects a plan, accepts the Terms and Withdrawal Policy, and requests immediate performance before placing the binding paid order through Stripe. The displayed total price, taxes, and billing interval govern. Subscriptions renew monthly until cancelled through the billing portal or the cancellation button at https://masterselects.com/cancel, normally effective at the end of the current billing period; receipt of a cancellation is confirmed electronically without delay.

Credits are non-transferable usage units for identified cloud and AI functions and have no cash value. Customers must protect account credentials, use the service lawfully, and hold the required rights to uploaded content. The customer receives a non-transferable contractual right of use; rights to customer content remain with the customer.

Statutory warranty rights apply. Liability is unlimited for intent, gross negligence, injury to life, body or health, product liability, and guarantees. For slight negligence involving an essential contractual duty, liability is limited to foreseeable typical loss; otherwise liability for slight negligence is excluded.

Consumers have the statutory right of withdrawal described separately. Online withdrawal is available at https://masterselects.com/withdrawal. German law applies while preserving mandatory consumer law at the consumer’s habitual residence. MasterSelects does not participate in consumer arbitration proceedings. The full German terms available at https://masterselects.com/agb govern the contract.`;

export const WITHDRAWAL_TEXT_EN = `MasterSelects Withdrawal Policy
Version: September 2, 2026

You have the right to withdraw from this contract within fourteen days without giving any reason. The withdrawal period expires fourteen days after the day the contract is concluded.

To exercise the right of withdrawal, inform Jan Roman Kuskowski, c/o POSTFLEX PFX-743-374, Emsdettener Straße 10, 48268 Greven, Germany, admin@masterselects.com, 0151 51484895, by an unequivocal statement such as a letter or email. You may also use the highlighted online withdrawal function at https://masterselects.com/withdrawal. It is sufficient to send the notice before the withdrawal period expires.

If you withdraw, we will reimburse all payments received from you without undue delay and no later than fourteen days after receiving your notice, using the same means of payment unless expressly agreed otherwise and without fees. If you requested that service begin during the withdrawal period, you must pay a proportionate amount for services already provided until you notified us.

Model withdrawal form: To Jan Roman Kuskowski at the address/email above — I hereby withdraw from my contract for a MasterSelects subscription. Ordered on: __. Name: __. Address: __. Date: __ (signature only if submitted on paper).

The full German withdrawal notice available at https://masterselects.com/widerruf governs.`;

export const CANCELLATION_TEXT_DE = `Verträge hier kündigen – MasterSelects

Mit dieser Schaltfläche können Sie Ihr kostenpflichtiges MasterSelects-Abonnement ordentlich kündigen (§ 312k BGB). Die Kündigung wird grundsätzlich zum Ende des laufenden Abrechnungszeitraums wirksam; ein früherer Termin ist auf Wunsch möglich. Sie erhalten unverzüglich eine elektronische Bestätigung mit Inhalt, Datum und Uhrzeit des Eingangs.

Damit wir den Vertrag zuordnen können, geben Sie bitte Ihren Namen, die beim Kauf verwendete E-Mail-Adresse und, falls vorhanden, eine Rechnungs- oder Vertragsnummer an. Alternativ können Sie jederzeit im Billing-Portal Ihres Kontos kündigen oder uns eine E-Mail an admin@masterselects.com senden.`;

export const CANCELLATION_TEXT_EN = `Cancel contracts here – MasterSelects

Use this button to give ordinary notice on your paid MasterSelects subscription (Section 312k German Civil Code). Cancellation normally takes effect at the end of the current billing period; an earlier date can be requested. You will receive an electronic confirmation of receipt with content, date, and time without delay.

So that we can match the contract, please state your name, the email address used at purchase and, if available, an invoice or contract reference. You can also cancel at any time in the billing portal of your account or by emailing admin@masterselects.com.`;

export function buildContractConfirmationText(input: {
  acceptedAt: string;
  planLabel: string;
  reference: string;
}): string {
  return `MasterSelects – Vertragsbestätigung / Contract confirmation

Tarif / Plan: ${input.planLabel}
Vertragsreferenz / Contract reference: ${input.reference}
Bestätigt am / Confirmed at: ${input.acceptedAt}

Sie haben die AGB (Version ${TERMS_VERSION}) akzeptiert, die Widerrufsbelehrung (Version ${WITHDRAWAL_VERSION}) gelesen und ausdrücklich verlangt, dass MasterSelects vor Ablauf der 14-tägigen Widerrufsfrist mit der Dienstleistung beginnt. Bei einem Widerruf nach Leistungsbeginn kann ein anteiliger Wertersatz für bereits erbrachte Leistungen anfallen.

You accepted the Terms (version ${TERMS_VERSION}), read the Withdrawal Policy (version ${WITHDRAWAL_VERSION}), and expressly requested that MasterSelects begin the service before the 14-day withdrawal period expires. A proportionate amount may be due for services already provided before withdrawal.

${TERMS_TEXT_DE}

${WITHDRAWAL_TEXT_DE}

English convenience translation

${TERMS_TEXT_EN}

${WITHDRAWAL_TEXT_EN}`;
}
