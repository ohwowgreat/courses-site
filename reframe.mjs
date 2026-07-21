// reframe.mjs — the student-voice rewrite stage of sync.mjs.
//
// The deterministic filter in sync.mjs is the privacy gate: withheld pages and
// stripped sections never reach this module, and that must stay true — the
// model here handles *tone*, never *secrecy*. What arrives is already safe to
// publish but still written in the vault's teacher/planning voice ("lesson
// docs still to write", "confirm with the exams officer", source-file
// provenance). Each page body is rewritten into the version that belongs on a
// student site, via the Claude API.
//
// Results are cached in reframe-cache.json keyed by a hash of (model, prompt
// version, filtered body), so a sync only re-rewrites pages whose filtered
// text actually changed. The cache is committed alongside content/ — a fresh
// clone reuses it, and the git diff of content/ stays the review surface for
// every rewrite before it is pushed.

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import Anthropic from "@anthropic-ai/sdk"

const MODEL = process.env.REFRAME_MODEL || "claude-opus-4-8"

// Bump when SYSTEM changes — invalidates every cache entry, forcing a full
// re-run on the next sync.
const PROMPT_VERSION = 1

const CONCURRENCY = 4

const SYSTEM = `You rewrite one page of a teacher's internal course-planning wiki into the version that belongs on the public, student-facing course website. The site serves high-school students at BNDS, many of whom read English as a second language: write plainly and directly, addressing the student as "you" where natural, or describing the course neutrally.

Keep every fact a student can act on, exactly as stated: dates, weekdays, times, week numbers, assessment codes and names (A1, CS2, SB1, HW1, EoT, the Final), formats, word counts, grading scales and weights, submission requirements, session-by-session content, unit structure, readings, and policies. Never invent anything: no new dates, requirements, links, or facts — and no encouragement, cheerleading, or filler the source does not contain.

Remove everything that serves the teacher or the wiki's own maintenance rather than the student:
- planning status: "lesson docs still to write", "map not yet drawn", "TBC", "PROPOSED", open items, what is missing or undecided in the planning
- source-file provenance: spreadsheet/PDF/workbook file names, comparisons between planning sources, "ingested", file paths, catalog and inventory notes
- authoring-process language: "the human", "confirmed", "resolved", correction history, notes about what the wiki records or fails to record
- instructions to staff or wiki maintainers: "redraw when the calendar publishes", "confirm with the exams officer / department", "do not reorder units", "confirm, do not infer", "move announcements, never sittings"
- scheduling rationale and cross-course planning comparisons that do not affect this course's students

Reframe what survives — do not merely delete. Prose written for the planner becomes information for the student: "A4 is announced on the A3 sitting day" is teacher scheduling; "you sit A4 on Wed 12-23" is student information. A warning that "a lost Wednesday costs a whole unit stage" can stay if it helps students understand why attendance matters, but strip the contingency planning around it.

When the source marks future dates as provisional or projected, keep the dates and add one plain sentence that they may shift when the school publishes the calendar for that period; drop the operational instructions around them. When the source records a genuinely unresolved question that affects students (an unconfirmed date, a unit that may run in one of two forms), state what is decided and note briefly that the rest will be confirmed in class — never present it as teacher deliberation.

Formatting rules:
- Keep the H1 title line exactly as written.
- Keep [[wikilinks]] exactly as they appear in the source — same target, same alias, including the [[path\\|alias]] form inside tables. Never invent a link that is not in the source.
- Keep tables that carry student-facing facts; drop rows or columns that are teacher-only.
- Keep Obsidian callouts (lines starting "> [!note]", "> [!important]", etc.) only where their content survives; retitle them for students if needed.
- Keep the total length the same or shorter than the source.
- Output only the rewritten markdown body — no preamble, no code fences, no commentary about what you changed.`

// Teacher-voice fragments that must not survive a rewrite. Checked against
// the model's output; one corrective retry, then a loud warning. This is a
// tripwire for review, not the privacy mechanism — that is sync.mjs's
// deterministic filter.
const LEAK_MARKERS = [
  /the human/i,
  /\braw\//,
  /ingest/i,
  /th[ie]s vault/i,
  /exams officer/i,
  /\bPROPOSED\b/,
  /confirm, do not infer/i,
  /still to write/i,
  /not yet drawn/i,
  // Audience-classifier meta-vocabulary: describes who a page is *for*, which
  // reads wrong on the student site itself. Kept to the two literal terms that
  // name this site's own audiences — a broad /-facing/ net would fire on
  // legitimate course prose ("Component 1-facing", "industry-facing").
  /student-facing/i,
  /teacher-facing/i,
]

const hashOf = (body) =>
  createHash("sha256").update(`${MODEL}\n${PROMPT_VERSION}\n${body}`).digest("hex")

// Wikilink targets, for the invented-link check. `\\` excluded so the
// table-escaped [[path\|alias]] form yields just the path; `#` drops anchors.
const linkTargets = (text) =>
  new Set([...text.matchAll(/\[\[([^\]|#\\]+)/g)].map((m) => m[1].trim()))

function problemsIn(rel, source, output) {
  const problems = []
  if (!output.trim()) problems.push("the rewrite is empty")
  for (const marker of LEAK_MARKERS) {
    const hit = output.match(marker)
    if (hit) problems.push(`teacher-voice fragment survived: "${hit[0]}"`)
  }
  const allowed = linkTargets(source)
  for (const target of linkTargets(output)) {
    if (!allowed.has(target)) problems.push(`invented wikilink target: [[${target}]]`)
  }
  return problems
}

async function loadCache(path) {
  try {
    const cache = JSON.parse(await readFile(path, "utf8"))
    if (cache && typeof cache.pages === "object") return cache
  } catch {
    /* no cache yet, or unreadable — start fresh */
  }
  return { version: 1, pages: {} }
}

// Bounded-concurrency map that preserves order.
async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

function makeClient() {
  try {
    // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
    // profile from the environment.
    return new Anthropic()
  } catch (err) {
    throw new Error(
      "reframe: no Claude API credentials found. Set ANTHROPIC_API_KEY (or run " +
        "`ant auth login`), or run REFRAME=off node sync.mjs to publish cached " +
        `rewrites only.\n  (${err.message})`,
    )
  }
}

function defaultCall(client) {
  return async (rel, body, fixNote) => {
    let user = `Page path: ${rel}\n\n<page>\n${body}\n</page>`
    if (fixNote) {
      user +=
        `\n\nYour previous rewrite had these problems — produce a corrected rewrite:\n` +
        fixNote.map((p) => `- ${p}`).join("\n")
    }
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    })
    if (res.stop_reason === "refusal")
      throw new Error(`model refused (${res.stop_details?.category ?? "no category"})`)
    if (res.stop_reason === "max_tokens") throw new Error("rewrite hit max_tokens")
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
    return text.replace(/^```(?:markdown)?\n([\s\S]*?)\n```\s*$/m, "$1").trim() + "\n"
  }
}

// Rewrite every page body in `pages` (array of {rel, body}) in place.
// Options: cachePath (required), disabled (REFRAME=off), call (test injection),
// log. Returns {cached, rewritten, kept} counts; `kept` pages shipped with the
// filtered-but-unreframed body and were warned about.
export async function reframeAll(pages, opts) {
  const { cachePath, disabled = false, log = console.log } = opts
  const cache = await loadCache(cachePath)

  const hits = []
  const misses = []
  for (const page of pages) {
    const hash = hashOf(page.body)
    const entry = cache.pages[page.rel]
    if (entry && entry.hash === hash) hits.push({ page, hash, body: entry.body })
    else misses.push({ page, hash })
  }

  for (const { page, body } of hits) page.body = body

  const kept = []
  if (misses.length && disabled) {
    for (const { page } of misses) kept.push(page.rel)
    log(`reframe: REFRAME=off — ${misses.length} changed page(s) published WITHOUT the`)
    log(`  student-voice rewrite (deterministic filter only). Re-run with credentials:`)
    for (const rel of kept) log(`    ${rel}`)
  } else if (misses.length) {
    const call = opts.call ?? defaultCall(makeClient())
    let done = 0
    await pool(misses, CONCURRENCY, async ({ page, hash }) => {
      let output, problems
      try {
        output = await call(page.rel, page.body)
        problems = problemsIn(page.rel, page.body, output)
        if (problems.length) {
          output = await call(page.rel, page.body, problems)
          problems = problemsIn(page.rel, page.body, output)
        }
      } catch (err) {
        // Auth/config failures abort the sync — every remaining page would
        // fail the same way, and content/ has not been touched yet.
        if (
          err instanceof Anthropic.AuthenticationError ||
          err instanceof Anthropic.PermissionDeniedError ||
          !(err instanceof Anthropic.APIError || /refused|max_tokens/.test(err.message))
        )
          throw err
        log(`reframe: ⚠ ${page.rel} failed (${err.message}) — publishing unreframed`)
        kept.push(page.rel)
        done++
        return
      }
      page.body = output
      if (problems.length) {
        // Ship it (the diff review is the last line of defense) but do NOT
        // cache it — every future sync re-attempts and re-warns until fixed.
        log(`reframe: ⚠ ${page.rel} still has problems after retry — review its diff:`)
        for (const p of problems) log(`    ${p}`)
      } else {
        cache.pages[page.rel] = { hash, body: output }
      }
      done++
      log(`reframe: ${done}/${misses.length} ${page.rel}`)
    })
  }

  // Prune entries for pages that no longer publish, and persist.
  const current = new Set(pages.map((p) => p.rel))
  for (const rel of Object.keys(cache.pages)) if (!current.has(rel)) delete cache.pages[rel]
  cache.version = 1
  cache.model = MODEL
  cache.prompt_version = PROMPT_VERSION
  await writeFile(cachePath, JSON.stringify(cache, null, 1) + "\n")

  return { cached: hits.length, rewritten: misses.length - kept.length, kept: kept.length }
}
