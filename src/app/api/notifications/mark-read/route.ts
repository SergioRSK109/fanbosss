import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Thin wrapper around marquer_notifications_lues() (migration 0034),
// same shape as every other RPC wrapper route in this project. Marks
// every one of the caller's own unread notifications read in one call --
// there is no per-id variant, see NotificationBell.tsx's own comment for
// why.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.rpc("marquer_notifications_lues");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
