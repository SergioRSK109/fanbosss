// CinetPay's return_url carries no reference back to which transaction
// was just paid for, so /paiement/retour can't otherwise know which
// offer type to show a tailored celebration message for. CheckoutButton
// stashes the type in sessionStorage right before redirecting to
// CinetPay's hosted checkout page; since return_url points back at this
// same origin, the value survives the round trip in the paying fan's own
// browser. A shared key (rather than a duplicated string literal in both
// the writer and the reader) rules out a silent typo-driven mismatch.
export const LAST_PAIEMENT_TYPE_STORAGE_KEY = "fanboss:lastPaiementType";
