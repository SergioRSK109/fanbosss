import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Client bound to the current request's session (respects RLS as the
 * logged-in user). Use this for anything a fan/créateur does themselves.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component with no response to write to;
            // safe to ignore when middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Service-role client that bypasses RLS. Only ever used server-side, from
 * trusted entry points that verify their own authorization before touching
 * data: the CinetPay webhook (verifies the HMAC signature) and the cron
 * route (verifies its own secret). Never import this from client code or
 * from a route that forwards an end-user's request unchecked.
 */
export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
