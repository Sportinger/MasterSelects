// The consumer-contract texts (Terms, Withdrawal Policy, business identity)
// are shared with the browser, which renders them on /agb and /widerruf and in
// the checkout consent. `src/legal/consumerContractTexts.ts` is the single
// source; this module only re-exports it for Pages Functions.
export * from '../../src/legal/consumerContractTexts';
