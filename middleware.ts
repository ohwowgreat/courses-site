// Site-wide password gate (Vercel Edge Middleware) with a styled login page.
//
// The published site is a static Quartz build with no access control of its own,
// so this middleware sits in front of every route. Unauthenticated visitors are
// redirected to a styled `/login` page; submitting the correct password sets a
// signed, HttpOnly session cookie and sends them on. Vercel picks up a root-level
// `middleware.ts` automatically, independent of the `npx quartz build` step.
//
// The password is read from the SITE_PASSWORD environment variable and is never
// stored in this repo, nor in the browser: the cookie holds an HMAC of a fixed
// message keyed by the password, so it proves knowledge of the password without
// containing it, and every cookie becomes invalid the moment the password changes.
// Set the password in the Vercel project with:  vercel env add SITE_PASSWORD
//
// Bump SESSION_VERSION to force every existing session to re-authenticate.

const COOKIE = "courses_session"
const SESSION_VERSION = "v1"
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export const config = {
  // Gate every route, including the landing page and static assets.
  matcher: "/:path*",
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const secret = process.env.SITE_PASSWORD

  // Fail closed: if no password is configured, do not serve the site unprotected.
  if (!secret) {
    return new Response("Site access is not configured yet.", { status: 503 })
  }

  const url = new URL(request.url)
  const path = url.pathname
  const sessionToken = await token(secret)
  const authed = safeEqual(parseCookie(request.headers.get("cookie"), COOKIE), sessionToken)

  // Log out: clear the cookie and return to the login page.
  if (path === "/logout") {
    return redirect("/login", clearCookie())
  }

  // Login form submission.
  if (path === "/login" && request.method === "POST") {
    const form = await request.formData()
    const next = sanitizeNext(url.searchParams.get("next"))
    if (String(form.get("password") ?? "") === secret) {
      return redirect(next, setCookie(sessionToken))
    }
    return html(loginPage({ error: true, next }), 401)
  }

  // Login page (already-authed visitors skip straight in).
  if (path === "/login") {
    if (authed) return redirect("/")
    return html(loginPage({ error: false, next: sanitizeNext(url.searchParams.get("next")) }))
  }

  // Everything else requires a valid session.
  if (authed) return // continue to the site
  return redirect(`/login?next=${encodeURIComponent(path + url.search)}`)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function redirect(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { location, "cache-control": "no-store" }
  const res = new Response(null, { status: 302, headers })
  if (cookie) res.headers.append("set-cookie", cookie)
  return res
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

function setCookie(value: string): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

// HMAC-SHA256(message = version, key = password) → hex. Deterministic per password,
// so the cookie never carries the password itself and rotates when it changes.
async function token(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SESSION_VERSION))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function parseCookie(header: string | null, name: string): string {
  if (!header) return ""
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return ""
}

function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Only allow same-site absolute paths as the post-login destination — never a
// protocol-relative or external URL — to avoid an open redirect.
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/"
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/"
  return next
}

function loginPage(opts: { error: boolean; next: string }): string {
  const action = `/login?next=${encodeURIComponent(opts.next)}`
  const error = opts.error ? `<p class="error">That password didn’t work. Try again.</p>` : ""
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Courses — sign in</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f3ee; color: #1c1b19;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    width: 100%; max-width: 380px; background: #fffdf9;
    border: 1px solid #e6e1d7; border-radius: 14px; padding: 40px 34px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .eyebrow { margin: 0 0 14px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8478; }
  h1 { margin: 0 0 8px; font-family: Georgia, "Times New Roman", serif; font-size: 24px; font-weight: 600; line-height: 1.25; }
  .sub { margin: 0 0 26px; font-size: 14px; color: #6b665c; line-height: 1.5; }
  label { display: block; margin-bottom: 16px; }
  label span { display: block; font-size: 13px; margin-bottom: 7px; color: #47433c; }
  input {
    width: 100%; padding: 11px 13px; font-size: 15px;
    border: 1px solid #d8d2c6; border-radius: 9px; background: #fff; color: inherit;
  }
  input:focus { outline: none; border-color: #1c1b19; box-shadow: 0 0 0 3px rgba(28,27,25,0.08); }
  button {
    width: 100%; padding: 12px; font-size: 15px; font-weight: 500; border: none;
    border-radius: 9px; background: #1c1b19; color: #f5f3ee; cursor: pointer;
  }
  button:hover { background: #333029; }
  .error { margin: 0 0 16px; font-size: 13.5px; color: #a3352b; }
  .foot { margin: 22px 0 0; font-size: 12px; color: #8a8478; }
  @media (prefers-color-scheme: dark) {
    body { background: #16150f; color: #ece8df; }
    .card { background: #201e18; border-color: #35322a; box-shadow: none; }
    .eyebrow, .foot { color: #8f897b; }
    .sub { color: #a49e8f; }
    label span { color: #c7c1b3; }
    input { background: #17160f; border-color: #3a362d; }
    input:focus { border-color: #ece8df; box-shadow: 0 0 0 3px rgba(236,232,223,0.10); }
    button { background: #ece8df; color: #201e18; }
    button:hover { background: #fff; }
    .error { color: #e88b7d; }
  }
</style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">Private course site</p>
    <h1>Enter the class password</h1>
    <p class="sub">Your teacher shared this at the start of the course. Enrolled students only.</p>
    <form method="post" action="${action}">
      <label>
        <span>Password</span>
        <input type="password" name="password" autocomplete="current-password" autofocus required />
      </label>
      ${error}
      <button type="submit">Continue</button>
    </form>
    <p class="foot">Trouble getting in? Ask your teacher for the password.</p>
  </main>
</body>
</html>`
}
