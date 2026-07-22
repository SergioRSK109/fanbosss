import { redirect } from "next/navigation";

// Merged into /dashboard (brief v3 point 1: no more fan/créateur split).
// Kept as a redirect so any existing bookmark/link still lands somewhere
// useful instead of 404ing.
export default function MesTransactionsPage() {
  redirect("/dashboard");
}
