// Shared date-formatting helper. Previously a private function declared
// inside TransactionActions.tsx alone (for /finance's contenu_debloque
// access-expiry display); GalerieViewer.tsx needs the exact same "when
// does access to this item end" formatting for the identical underlying
// concept (a non-expired contenu_debloque item's expiresAt), so this was
// extracted here rather than duplicated a second time -- the two call
// sites must always agree on the same format, not just look similar.
//
// Constructing a Date from an already-known ISO string is a pure,
// deterministic operation (same input, same output) -- unlike
// Date.now()/`new Date()` with no argument, this is fine to call during
// render. The actual "is it expired" *comparison* against the current
// wall clock stays computed server-side wherever that matters (see
// contenuDebloque.ts/isAccesExpire) -- this helper only ever formats an
// already-decided date, never decides one itself.
export function formatExpirationDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}
