import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // E2E test fixture bypass — never active in production
  const fixtureParam = request.nextUrl.searchParams.get("__fixture");
  const isTestFixture = process.env.NODE_ENV !== "production" && fixtureParam !== null;

  const isPublic =
    isTestFixture ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/") ||
    pathname === "/";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Pass fixture flag as request header so layout.tsx can read it via headers()
  if (isTestFixture) {
    const res = NextResponse.next({
      request: {
        headers: new Headers({
          ...Object.fromEntries(request.headers.entries()),
          "x-fixture": fixtureParam ?? "1",
        }),
      },
    });
    // Copy cookies from supabaseResponse
    supabaseResponse.cookies.getAll().forEach(({ name, value }) => res.cookies.set(name, value));
    return res;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
