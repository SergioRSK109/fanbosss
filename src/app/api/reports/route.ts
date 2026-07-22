import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Brief 4.3: a "signaler/bloquer" action must always be available on a
// créateur's profile, independent of the WhatsApp opt-in flow.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const reportedUserId = String(body.reportedUserId ?? "");
  const type = String(body.type ?? "");
  const raison = body.raison ? String(body.raison) : null;

  if (!reportedUserId || !["signalement", "blocage"].includes(type)) {
    return NextResponse.json({ error: "payload invalide" }, { status: 400 });
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    reported_user_id: reportedUserId,
    type,
    raison,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
