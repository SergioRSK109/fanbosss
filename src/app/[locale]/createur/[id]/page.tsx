import { notFound } from "next/navigation";
import { CreateurProfileView } from "@/components/CreateurProfileView";
import { getCreateurProfileData } from "@/lib/profil";

// Canonical/internal profile route, keyed by the real user id. The public
// alias fanboss.app/@pseudo (src/app/[locale]/[handle]) resolves a pseudo
// to this same id and renders the identical view via
// getCreateurProfileData/CreateurProfileView.
export default async function CreateurProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCreateurProfileData(id);

  if (!profile) {
    notFound();
  }

  return <CreateurProfileView profile={profile} />;
}
