import { NextRequest, NextResponse } from "next/server";
import { getPublicationsExplorables } from "@/lib/publications";

// Backs Explorer's infinite-scroll grid (Phase C) -- the initial batch is
// server-rendered directly by /explorer/page.tsx (no round trip needed),
// this route is only for every subsequent batch the client requests as
// the visitor scrolls. No auth required: publications_explorables
// (migration 0038) is granted to anon, same as the créateur directory it
// replaces.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const cursorCreatedAt = request.nextUrl.searchParams.get("cursorCreatedAt");
  const cursorId = request.nextUrl.searchParams.get("cursorId");

  const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : null;

  const { publications, nextCursor } = await getPublicationsExplorables(q, cursor);

  return NextResponse.json({ publications, nextCursor });
}
