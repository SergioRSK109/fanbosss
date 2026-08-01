// Required fallback for the @modal parallel-routes slot (Lot 5d): on a
// hard navigation/refresh to any URL that doesn't match the intercepted
// (.)[handle]/p/[id] route below, Next.js can't recover this slot's
// active state and renders this file instead -- returning null is what
// keeps the modal invisible everywhere except right after an internal
// navigation actually opened it. See CLAUDE.md's "Publication fullscreen
// viewer" section and Next's own Parallel Routes docs (`default.js`).
export default function ModalDefault() {
  return null;
}
