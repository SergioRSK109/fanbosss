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
  // `/api` and `/auth` MUST stay excluded: next-intl's rewrite targets the
  // app/[locale] tree, and both live outside it -- routing either through
  // next-intl would 404 it. This was empirically reproduced for
  // `/auth/callback` (the Supabase email confirmation/password-reset
  // redirect target): without this exclusion, next-intl still rewrites an
  // *unprefixed* request for it to `/fr/auth/callback` internally (its
  // default-locale rewrite applies regardless of localePrefix:"as-needed"
  // -- that setting only controls whether the URL bar shows a prefix, not
  // whether the internal rewrite happens), and since there is no
  // app/[locale]/auth/callback route, that 404s every single confirmation
  // link. `curl -v` against a real dev server confirms the exact
  // `x-middleware-rewrite: /fr/auth/callback?code=...` → 404 chain -- see
  // CLAUDE.md's "Email confirmation / password reset link 404" section.
  // API route handlers and /auth/callback already call
  // supabase.auth.getUser()/exchangeCodeForSession() themselves (which
  // auto-refresh via the same SSR cookie cycle), so neither needs the
  // proxy's proactive refresh the way page navigations do.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
