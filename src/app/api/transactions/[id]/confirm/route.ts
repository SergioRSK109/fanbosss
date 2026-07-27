import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lot 2a: a fan marking a delivered video/shoutout as satisfactory. The
// state machine itself (ownership check, statut='livree' +
// confirmation_fan='en_attente' eligibility guard) lives in the
// confirmer_livraison_fan() SECURITY DEFINER function
// (supabase/migrations/0025_confirmation_fan_video_shoutout.sql) -- this
// route is a thin wrapper, same shape as accept/refuse, so a fan can
// never write confirmation_fan directly.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.rpc("confirmer_livraison_fan", {
    p_transaction_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
