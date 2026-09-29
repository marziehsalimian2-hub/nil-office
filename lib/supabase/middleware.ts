import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login");
  const isPublicAsset =
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path === "/manifest.webmanifest";
  // Buyer Portal — anonymous by design, reached only via an unguessable
  // token in the URL (/offer/[token]). Deliberately NOT under /trade/*
  // — that prefix already belongs to the authenticated admin section
  // (app/(app)/trade/...; route groups add no URL segment, so /trade/*
  // there and a top-level /trade/[token] would collide). Its own route
  // handlers do all authorization from the token itself; nothing here
  // should ever bounce an anonymous buyer to /login.
  const isTradePortal = path.startsWith("/offer/");
  // Telegram webhooks — no Supabase session exists for either (Telegram
  // carries no cookies at all), and neither has a login page to redirect
  // to in the first place. Each does its own authentication entirely
  // inline (webhook-secret header, then either the internal allowlist +
  // identity mapping — lib/assistant/telegram/security.ts/identity.ts —
  // or, for the external bot, no allowlist at all by design — see
  // lib/external-bot/telegram/security.ts), same shape as the Buyer
  // Portal's own token-based auth replacing a Supabase session.
  // Without this carve-out, every webhook POST is silently redirected
  // to /login (a 307) and Telegram logs it as "Wrong response from the
  // webhook" — found live for the internal bot originally (see git
  // history), and reproduced live for the external bot's own separate
  // path when it was first wired up, since this check only ever
  // matched the internal bot's exact path.
  const isTelegramWebhook = path === "/api/telegram/webhook" || path === "/api/telegram/external-webhook";
  // Set by requireProfile() when the signed-in user has no active profile.
  // Must NOT be bounced back to /dashboard below, or the two redirects loop forever.
  const isInactiveNotice = path === "/login" && request.nextUrl.searchParams.get("inactive") === "1";

  if (!user && !isAuthRoute && !isPublicAsset && !isTradePortal && !isTelegramWebhook) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute && !isInactiveNotice) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}