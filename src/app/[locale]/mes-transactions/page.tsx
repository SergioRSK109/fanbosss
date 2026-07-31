import { redirect } from "@/i18n/navigation";

// Merged into /dashboard (brief v3 point 1: no more fan/créateur split),
// which itself later moved this exact transactions content to /finance
// (Lot 2b) and was then deleted outright once its remaining Performance
// content moved into /parametres (Lot 3 merge follow-up) -- redirects
// straight there now instead of through a dead /dashboard hop. Kept as a
// redirect so any existing bookmark/link still lands somewhere useful
// instead of 404ing.
export default async function MesTransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/finance", locale });
}
