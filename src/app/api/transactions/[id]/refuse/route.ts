import { NextRequest, NextResponse } from "next/server";
import { processAutomaticRefund } from "@/lib/refunds";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

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

  const { error } = await supabase.rpc("refuse_transaction", {
    p_transaction_id: id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // refuse_transaction already re-verified ownership (createur_id =
  // auth.uid()) before flipping the transaction to 'remboursee' -- service
  // role is only used for this follow-up write (transactions has no
  // authenticated-user UPDATE policy at all), not to bypass that check.
  await processAutomaticRefund(createSupabaseServiceRoleClient(), id);

  return NextResponse.json({ status: "ok" });
}
