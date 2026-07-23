// Minimal passthrough: every actual page lives under app/[locale], whose
// layout renders <html>/<body> with the resolved locale. This root layout
// only exists because Next.js requires exactly one at this position; see
// next-intl's App Router setup guide.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
