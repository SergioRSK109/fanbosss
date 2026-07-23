import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware Link/redirect/useRouter -- use these instead of the plain
// next/navigation ones anywhere the app links to/redirects to its own
// pages, so an English-language visitor doesn't get bounced back to an
// unprefixed (French) URL on internal navigation.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
