import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  // next-intl runs first: it may redirect (e.g. add a locale cookie) or
  // rewrite the pathname to include the locale segment internally (so
  // `/signup` resolves to app/[locale]/signup with locale='fr' while the
  // URL bar still shows `/signup`). The Supabase session refresh below
  // writes its cookies onto this SAME response, whatever it is -- see
  // next-intl's "Middleware composition" guide.
  const response = intlMiddleware(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session cookie if needed so Server Components always see
  // an up-to-date auth.getUser() result.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // `/api` MUST stay excluded: next-intl's rewrite targets the
  // app/[locale] tree, and API routes live outside it -- routing an API
  // request through next-intl would 404 it. API route handlers already
  // call supabase.auth.getUser() themselves (which auto-refreshes via the
  // same SSR cookie cycle), so they don't need the proxy's proactive
  // refresh the way page navigations do.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
