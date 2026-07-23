// Shared with signup, login and réglages forms -- same reasoning as
// button-styles.ts: a plain string constant, not a component, since every
// call site is a plain native <input>/<textarea>/<select>.
// No width utility here on purpose: some call sites need it full-width,
// others (inline price fields) need a fixed narrow width -- baking in
// "w-full" would fight a caller's own width class since Tailwind doesn't
// resolve same-specificity utility conflicts by source order.
export const inputClass =
  "rounded-2xl border border-border bg-surface px-4 py-3 text-[0.95rem] text-foreground outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-foreground";
