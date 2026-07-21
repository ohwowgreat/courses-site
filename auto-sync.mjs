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
import { appendFileSync } from "node:fs"

process.chdir(import.meta.dirname)
process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim()

function notify(title, message) {
  console.log(`[${title}] ${message}`)
  try {
    execFileSync("/usr/bin/osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(`Courses site: ${title}`)}`,
    ])
  } catch {
    /* headless / non-mac — the log line above is enough */
  }
}

// ── Credentials ──────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    process.env.ANTHROPIC_API_KEY = sh(
      `security find-generic-password -a "$USER" -s ANTHROPIC_API_KEY -w`,
    )
  } catch {
    /* not in the keychain either — sync.mjs will fail with its own message */
  }
}

// ── Preconditions: clean main, in step with origin ──────────────────────────
const branch = sh("git rev-parse --abbrev-ref HEAD")
if (branch !== "main") {
  notify("skipped", `repo is on '${branch}', not main — not auto-publishing`)
  process.exit(0)
}

// content/ and reframe-cache.json are regenerated every run, so leftover
// changes there (e.g. from a previous warned run) don't block; anything else
// dirty means a human is mid-work in the repo — stay out of the way.
const dirty = sh(`git status --porcelain -- ':!content' ':!reframe-cache.json'`)
if (dirty) {
  notify("skipped", "uncommitted changes outside content/ — resolve manually")
  console.log(dirty)
  process.exit(0)
}

try {
  sh("git pull --ff-only origin main", { stdio: ["ignore", "pipe", "pipe"] })
} catch (err) {
  notify("error", "could not fast-forward main from origin — resolve manually")
  console.log(String(err.stderr || err.message))
  process.exit(1)
}

// ── Sync ─────────────────────────────────────────────────────────────────────
let output
try {
  output = sh("node sync.mjs 2>&1", { maxBuffer: 64 * 1024 * 1024 })
} catch (err) {
  console.log(String(err.stdout || ""))
  notify("sync failed", String(err.stdout || err.message).trim().split("\n").at(-1))
  process.exit(1)
}
console.log(output)

if (output.includes("⚠")) {
  notify(
    "review needed",
    "sync produced warnings — nothing was published; will retry next run",
  )
  process.exit(0)
}

// ── Publish ──────────────────────────────────────────────────────────────────
sh("git add content reframe-cache.json")
const summary = output
  .split("\n")
  .filter((l) => /^(Published|Reframed)/.test(l))
  .join("\n")
if (sh("git diff --cached --name-only")) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  execFileSync("git", ["commit", "-q", "-m", `Auto-sync ${stamp}`, "-m", summary])
}

// Push anything unpushed — this run's commit, or one left over from a run
// whose push failed.
if (sh("git rev-list --count origin/main..HEAD") !== "0") {
  let pushed = false
  for (const wait of [0, 2, 4, 8, 16]) {
    if (wait) execSync(`sleep ${wait}`)
    try {
      sh("git push origin main", { stdio: ["ignore", "pipe", "pipe"] })
      pushed = true
      break
    } catch {
      /* transient network — retry with backoff */
    }
  }
  if (!pushed) {
    notify("error", "push failed after retries — commit is local; will push next run")
    process.exit(1)
  }
  notify("published", summary.split("\n")[0] || "site updated")
} else {
  console.log("No changes — nothing to publish.")
}
