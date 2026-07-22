import Link from "next/link";

export default function PaiementRetourPage() {
  return (
    <main className="mx-auto max-w-sm p-6 flex flex-col gap-4 text-center">
      <h1 className="text-2xl font-semibold">Merci !</h1>
      <p>
        Votre paiement est en cours de confirmation. Vous retrouverez son
        statut dans <Link href="/dashboard" className="underline">votre espace</Link>{" "}
        dès que CinetPay l&apos;aura validé.
      </p>
    </main>
  );
}
