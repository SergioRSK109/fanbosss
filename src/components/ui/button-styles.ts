// Plain class-name builder, not a component: buttons in this app are a mix
// of <button> (forms, actions) and the locale-aware <Link> from
// @/i18n/navigation (homepage CTAs), which don't share a common element
// type -- a builder function lets both use the exact same visual styling
// without wrapping Link in a polymorphic component.
type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-[0_10px_24px_-10px_rgba(124,58,237,0.65)] hover:bg-brand-600",
  secondary:
    "bg-accent-500 text-white shadow-[0_10px_24px_-10px_rgba(255,122,69,0.6)] hover:bg-accent-600",
  outline:
    "border-2 border-brand-500 text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-white/5",
  ghost: "text-foreground-muted hover:text-foreground",
  danger: "bg-danger-500 text-white hover:bg-danger-600",
  success: "bg-success-500 text-white hover:bg-success-600",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-4 py-2",
  md: "text-[0.95rem] px-5 py-3",
  lg: "text-lg px-7 py-4",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className = "") {
  return [base, variants[variant], sizes[size], className].filter(Boolean).join(" ");
}
