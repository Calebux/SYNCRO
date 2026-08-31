import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
            }),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !request.nextUrl.pathname.startsWith("/auth") && request.nextUrl.pathname !== "/") {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  if (user && request.nextUrl.pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  // AAL enforcement: only apply to protected routes for authenticated users
  if (user && isProtectedRoute(request.nextUrl.pathname)) {
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (aalData) {
      const { currentLevel, nextLevel } = aalData

      // User has 2FA enrolled but session is not yet elevated — redirect to verify
      if (currentLevel === "aal1" && nextLevel === "aal2") {
        const url = request.nextUrl.clone()
        url.pathname = "/auth/2fa"
        url.searchParams.set("redirectTo", request.nextUrl.pathname + request.nextUrl.search)
        return NextResponse.redirect(url)
      }

      // User has no 2FA enrolled (nextLevel stays aal1) — check if team requires it
      if (nextLevel === "aal1") {
        const teamEnforces = await checkTeamRequires2FA(supabase, user.id)
        if (teamEnforces) {
          const url = request.nextUrl.clone()
          url.pathname = "/settings/security"
          url.searchParams.set("enforce", "true")
          return NextResponse.redirect(url)
        }
      }
    }
  }

  return supabaseResponse
}

/**
 * Returns true for routes that require authentication and AAL enforcement.
 * Excludes: `/`, `/auth/*`, `/api/*`, `/_next/*`, `/favicon.ico`, `/_vercel/*`
 */
function isProtectedRoute(pathname: string): boolean {
  if (pathname === "/") return false
  if (pathname.startsWith("/auth/")) return false
  if (pathname.startsWith("/api/")) return false
  if (pathname.startsWith("/_next/")) return false
  if (pathname.startsWith("/_vercel/")) return false
  if (pathname === "/favicon.ico") return false
  return true
}

/**
 * Checks whether the authenticated user belongs to a team that has `require_2fa=true`.
 * Checks both teams the user owns and teams they are a member of.
 * Fails open on DB error (returns false) to avoid blocking legitimate logins.
 */
async function checkTeamRequires2FA(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<boolean> {
  try {
    // Check teams owned by the user
    const { data: ownedTeams, error: ownedError } = await supabase
      .from("teams")
      .select("require_2fa")
      .eq("owner_id", userId)
      .eq("require_2fa", true)
      .limit(1)

    if (!ownedError && ownedTeams && ownedTeams.length > 0) {
      return true
    }

    // Check teams the user is a member of
    const { data: memberships, error: memberError } = await supabase
      .from("team_members")
      .select("team_id, teams!inner(require_2fa)")
      .eq("user_id", userId)
      .eq("teams.require_2fa", true)
      .limit(1)

    if (!memberError && memberships && memberships.length > 0) {
      return true
    }

    return false
  } catch {
    // Fail open — do not block login on DB error
    return false
  }
}
