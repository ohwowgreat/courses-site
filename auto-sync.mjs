#!/usr/bin/env node
// Automated vault → site publish. Installed as a launchd user agent by
// install-autosync.sh; on each run it does exactly what the manual workflow
// did: node sync.mjs → commit content/ → push main → Vercel deploys.
//
// The one thing automation removes is the human diff review, so this script
// is deliberately cowardly:
//   - it only publishes from a clean `main` that fast-forwards to origin;
//   - it never publishes a run whose sync output carries a ⚠ warning — it
//     sends a macOS notification instead, and the next scheduled run retries
//     (failed rewrites are never cached, so nothing gets stuck);
//   - the privacy filter does not depend on any of this: it runs inside
//     sync.mjs, deterministically, before any page reaches the model.
//
// launchd runs with a bare environment: no ~/.zshrc, minimal PATH, no
// ANTHROPIC_API_KEY. PATH is extended below; the key is read from the macOS
// Keychain (see install-autosync.sh for the one-time `security` command).

import { execFileSync, execSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

process.chdir(import.meta.dirname)

process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim()

// The log carried no timestamps at all, so "when did this last run, and did it
// fail every morning or just once" could not be answered from it — the site's own
// commit history had to stand in. Stamp the run boundary and every status line.
const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19)
const log = (...a) => console.log(`[${ts()}]`, ...a)

// Reaching GitHub from this machine fails intermittently: the log shows
// SSL_ERROR_SYSCALL and "HTTP2 framing layer" aborting otherwise healthy runs,
// and launchd runs bare (no proxy in its environment, unlike an interactive
// shell). These are worth retrying. A non-fast-forward, by contrast, is a real
// divergence that a human must look at, so it must NOT be retried.
const TRANSIENT =
  /unable to access|SSL_ERROR|SSL_connect|HTTP2 framing|Could not resolve host|Connection reset|Recv failure|Empty reply|Operation timed out|TLS connect|gnutls|Failed to connect/i

// Optional last resort. If every direct attempt failed and this machine has a
// local proxy listening (the one an interactive shell uses), try once through it
// before giving up. Nothing depends on the proxy existing.
const FALLBACK_PROXY = process.env.GIT_FALLBACK_PROXY ?? "http://127.0.0.1:1082"

function proxyListening() {
  try {
    const u = new URL(FALLBACK_PROXY)
    execFileSync("/usr/bin/nc", ["-z", "-G", "1", "-w", "1", u.hostname, u.port], {
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

// Retry a git network command through transient failures. Returns its stdout.
// Throws immediately on anything that is not a recognised network error.
function gitRetry(cmd, label) {
  let lastErr
  for (const wait of [0, 5, 15, 40]) {
    if (wait) execSync(`sleep ${wait}`)
    try {
      return sh(cmd, { stdio: ["ignore", "pipe", "pipe"] })
    } catch (err) {
      lastErr = err
      const msg = String(err.stderr || err.message)
      if (!TRANSIENT.test(msg)) throw err
      log(`${label}: transient network error, retrying — ${msg.trim().split("\n").at(-1)}`)
    }
  }
  if (proxyListening()) {
    log(`${label}: direct attempts failed; retrying once via ${FALLBACK_PROXY}`)
    try {
      return sh(cmd, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HTTPS_PROXY: FALLBACK_PROXY, HTTP_PROXY: FALLBACK_PROXY },
      })
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

function notify(title, message) {
  console.log(`[${ts()}] [${title}] ${message}`)
  try {
    execFileSync("/usr/bin/osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(`Courses site: ${title}`)}`,
    ])
  } catch {
    /* headless / non-mac — the log line above is enough */
  }
}

// ── Status file ──────────────────────────────────────────────────────────────
// Every run rewrites one JSON file inside the vault, whatever the outcome, so the
// vault dashboard can state the truth instead of carrying a hand-kept guess. This
// exists because home.md asserted "publishing is blocked" for about two weeks after
// the cause had been fixed: a notification is gone in a second, and a missing change
// looks identical whether the sync warned, the repo was dirty, or GitHub was down.
//
// It is the ONLY thing here that writes back into the vault, and it stays outside
// wiki/ (which sync.mjs walks, so a file there would become a published page) at a
// path the vault's .gitignore excludes. Runtime state, not knowledge. A failure to
// write it must never fail a publish, hence the swallowed catch.
const VAULT_ROOT = process.env.VAULT_ROOT ?? "/Users/dogan/Documents/Vaults/Courses"
const STATUS_FILE = join(VAULT_ROOT, "assets", "dashboard", "site-status.json")

const grab = (re, s, i = 1) => {
  const m = re.exec(s ?? "")
  return m ? Number(m[i]) : null
}

// "published" — this run pushed something. "current" — sync verified the site is
// already up to date. Everything else needs a human, and the dashboard says so.
const HEALTHY = new Set(["published", "current"])

// The first status file has no history to carry forward, which would report "never
// published" on a site that has been live for weeks. Recover it from the commits
// this script itself writes, so the field is right from the first run.
function lastAutoSyncCommit() {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI|%h", "--grep=^Auto-sync "], {
      encoding: "utf8",
    }).trim()
    if (!out) return {}
    const [at, sha] = out.split("|")
    return { at, sha }
  } catch {
    return {}
  }
}

function writeStatus(outcome, detail, output = "") {
  try {
    let prev = {}
    try {
      prev = JSON.parse(readFileSync(STATUS_FILE, "utf8"))
    } catch {
      /* first run, or the file was cleaned away */
    }
    const published = outcome === "published"
    let sha = null
    try {
      sha = sh("git rev-parse --short HEAD")
    } catch {
      /* not a repo / git unavailable — the rest of the status is still useful */
    }
    const status = {
      ranAt: new Date().toISOString(),
      outcome,
      detail,
      healthy: HEALTHY.has(outcome),
      warnings: (output.match(/⚠/g) ?? []).length,
      warningLines: (output.match(/^⚠.*$/gm) ?? []).slice(0, 6),
      anchorFallbacks: (output.match(/^anchor fallback/gm) ?? []).length,
      pages: {
        published: grab(/Published (\d+) of \d+ pages/, output),
        total: grab(/Published \d+ of (\d+) pages/, output),
        withheld: grab(/\((\d+) withheld/, output),
      },
      decks: {
        lesson: grab(/Published (\d+) lesson deck/, output),
        course: grab(/and (\d+) course deck/, output),
      },
      // Carried forward on every non-publishing run, so "when did students last
      // get a change" survives a week of quiet or failed ones; recovered from the
      // git log when there is no previous file to carry.
      lastPublishedAt: published
        ? new Date().toISOString()
        : (prev.lastPublishedAt ?? lastAutoSyncCommit().at ?? null),
      lastPublishedSha: published ? sha : (prev.lastPublishedSha ?? lastAutoSyncCommit().sha ?? null),
      headSha: sha,
    }
    mkdirSync(dirname(STATUS_FILE), { recursive: true })
    writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`)
  } catch (err) {
    console.log(`[status] could not write ${STATUS_FILE}: ${err.message}`)
  }
}

// Write the status, then notify, then leave. Every exit path below goes through
// this, which is the point — a run that dies without recording why is the failure
// mode this file was added to remove.
function finish(code, outcome, message, output = "") {
  writeStatus(outcome, message, output)
  notify(outcome, message)
  process.exit(code)
}

log("── run start ──")

// ── Credentials ──────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    // By service alone. Matching the account as well would be one more thing
    // that has to hold in an environment launchd deliberately keeps bare: an
    // unset USER expands to `-a ""`, which matches no item, and the run would
    // then fail on its first cache miss with nothing in the log to explain why.
    process.env.ANTHROPIC_API_KEY = sh(`security find-generic-password -s ANTHROPIC_API_KEY -w`)
  } catch {
    /* not in the keychain either — sync.mjs will fail with its own message */
  }
}

// ── Preconditions: clean main, in step with origin ──────────────────────────
const branch = sh("git rev-parse --abbrev-ref HEAD")
if (branch !== "main") {
  finish(0, "skipped", `repo is on '${branch}', not main — not auto-publishing`)
}

// content/ and reframe-cache.json are regenerated every run, so leftover
// changes there (e.g. from a previous warned run) don't block; anything else
// dirty means a human is mid-work in the repo — stay out of the way.
const dirty = sh(`git status --porcelain -- ':!content' ':!reframe-cache.json'`)
if (dirty) {
  console.log(dirty)
  finish(0, "skipped", "uncommitted changes outside content/ — resolve manually")
}

try {
  gitRetry("git pull --ff-only origin main", "pull")
} catch (err) {
  const msg = String(err.stderr || err.message)
  console.log(msg)
  // Two very different failures wore the same message before: a transient network
  // error (retries next run, nothing for a human to do) and a genuine divergence
  // (needs a human). Saying "resolve manually" for a blip sent the reader looking
  // for a git problem that was not there.
  finish(
    1,
    "error",
    TRANSIENT.test(msg)
      ? "GitHub unreachable after retries — nothing to fix; will retry next run"
      : "main does not fast-forward from origin — diverged, resolve manually",
  )
}

// ── Sync ─────────────────────────────────────────────────────────────────────
let output
try {
  output = sh("node sync.mjs 2>&1", { maxBuffer: 64 * 1024 * 1024 })
} catch (err) {
  const failed = String(err.stdout || "")
  console.log(failed)
  finish(
    1,
    "sync failed",
    String(err.stdout || err.message)
      .trim()
      .split("\n")
      .at(-1),
    failed,
  )
}
console.log(output)

if (output.includes("⚠")) {
  finish(
    0,
    "review needed",
    "sync produced warnings — nothing was published; will retry next run",
    output,
  )
}

// ── Publish ──────────────────────────────────────────────────────────────────
sh("git add content reframe-cache.json")
const summary = output
  .split("\n")
  .filter((l) => /^(Published|Reframed)/.test(l))
  .join("\n")

// Whether THIS run changed anything students can see. The push below fires for any
// unpushed commit, including ones that have nothing to do with content (a fix to
// this script, say). Reporting those as "published" would move the dashboard's
// "students last got a change" to today on a day students got nothing.
let publishedContent = false
if (sh("git diff --cached --name-only")) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  execFileSync("git", ["commit", "-q", "-m", `Auto-sync ${stamp}`, "-m", summary])
  publishedContent = true
}

// Push anything unpushed — this run's commit, or one left over from a run
// whose push failed.
if (sh("git rev-list --count origin/main..HEAD") !== "0") {
  try {
    gitRetry("git push origin main", "push")
  } catch {
    finish(1, "error", "push failed after retries — commit is local; will push next run", output)
  }
  finish(
    0,
    publishedContent ? "published" : "current",
    publishedContent
      ? summary.split("\n")[0] || "site updated"
      : "sync clean; pushed non-content commits, students saw no change",
    output,
  )
} else {
  // Not a failure: sync ran clean and the site already matches the vault. Recorded
  // as its own outcome so the dashboard can distinguish "verified current today"
  // from "last published three days ago and untested since".
  console.log("No changes — nothing to publish.")
  writeStatus("current", "sync clean; site already matches the vault", output)
}
