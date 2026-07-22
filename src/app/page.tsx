import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold">FanBoss</h1>
      <p className="max-w-md text-gray-600 dark:text-gray-300">
        Monétisez votre relation avec vos fans : vidéos personnalisées, dons,
        accès WhatsApp premium.
      </p>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="bg-violet-600 text-white rounded px-4 py-2"
        >
          Créer un compte
        </Link>
        <Link href="/login" className="border rounded px-4 py-2">
          Se connecter
        </Link>
      </div>
    </main>
  );
}
