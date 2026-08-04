import { NextRequest, NextResponse } from "next/server";
import { parseTheme, THEME_COOKIE_MAX_AGE_SECONDS, THEME_COOKIE_NAME } from "@/lib/theme";

// No auth required -- a theme preference isn't account data (it's never
// stored in the DB, see CLAUDE.md), so a logged-out visitor browsing a
// public profile must be able to set it too, same "no session needed for
// a non-sensitive preference" reasoning as /api/publications/[id]/vue.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const theme = parseTheme(body.theme);

  const response = NextResponse.json({ theme });
  response.cookies.set(THEME_COOKIE_NAME, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });
  return response;
}
