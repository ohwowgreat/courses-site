// Site-wide password gate (Vercel Edge Middleware).
//
// The published site is a static Quartz build with no access control of its own,
// so this middleware sits in front of every route and requires a single shared
// password before anything is served. It runs on Vercel's edge for all requests
// — Vercel picks up a root-level `middleware.ts` automatically, independent of
// the `npx quartz build` step that produces `public/`.
//
// The password is read from the SITE_PASSWORD environment variable and is never
// stored in this repo. Set it in the Vercel project (Production + Preview) with:
//   vercel env add SITE_PASSWORD
// Locally, put it in `.env` (gitignored). See README for the workflow.
//
// Auth model: HTTP Basic Auth. The browser shows its native login dialog; the
// username is ignored, only the password is checked. Credentials are cached by
// the browser per-origin, so students are prompted once, not on every asset.

export const config = {
  // Gate every route, including the landing page and static assets.
  matcher: "/:path*",
}

export default function middleware(request: Request): Response | undefined {
  const expected = process.env.SITE_PASSWORD

  // Fail closed: if no password is configured, do not silently serve the site
  // unprotected — return a clear "not set up yet" state instead. This makes a
  // missing env var obvious (the whole site 503s) rather than quietly open.
  if (!expected) {
    return new Response("Site access is not configured yet.", { status: 503 })
  }

  const header = request.headers.get("authorization") ?? ""
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6))
    // Split on the first colon only; the password itself may contain colons.
    const password = decoded.slice(decoded.indexOf(":") + 1)
    if (password === expected) return // authorized → continue to the site
  }

  return new Response("Password required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Enter the class password", charset="UTF-8"',
    },
  })
}
