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
const PROMPT_VERSION = 3

const CONCURRENCY = 4

const SYSTEM = `You rewrite one page of a teacher's internal course-planning wiki into the version that belongs on the public, student-facing course website. The site serves high-school students at BNDS, many of whom read English as a second language: write plainly and directly, addressing the student as "you" where natural, or describing the course neutrally.

House voice, on every page:
- Short sentences. Plain words. Prefer the everyday word, except for course vocabulary, which must appear by its exact name.
- Never write an em dash (—) in prose. Use a comma, a colon, or a new sentence instead. Hyphens in compound words and en dashes inside ranges (pp. 2–15, 2026–27) are fine, and em dashes inside tables are part of the data and stay.
- Never write an exclamation mark.
- US spelling throughout (color, modeled, analyze, catalog), except inside verbatim quotations and official names ("Learning Behaviour", the "A-Level Programme").
- When the page teaches or uses a named concept, term, theorist, or mechanism, state the name explicitly, bold at its first definition. Never gesture at an idea ("the concept from last week") without naming it.

Keep every fact a student can act on, exactly as stated: dates, weekdays, times, week numbers, assessment codes and names (A1, CS2, SB1, HW1, EoT, the Final), formats, word counts, grading scales and weights, submission requirements, session-by-session content, unit structure, readings, and policies. Never invent anything: no new dates, requirements, links, or facts — and no encouragement, cheerleading, or filler the source does not contain.

Remove everything that serves the teacher or the wiki's own maintenance rather than the student:
- planning status: "lesson docs still to write", "map not yet drawn", "TBC", "PROPOSED", open items, what is missing or undecided in the planning
- source-file provenance: spreadsheet/PDF/workbook file names, comparisons between planning sources, "ingested", file paths, catalog and inventory notes
- authoring-process language: "the human", "confirmed", "resolved", correction history, notes about what the wiki records or fails to record
- instructions to staff or wiki maintainers: "redraw when the calendar publishes", "confirm with the exams officer / department", "do not reorder units", "confirm, do not infer", "move announcements, never sittings"
- scheduling rationale and cross-course planning comparisons that do not affect this course's students

Reframe what survives — do not merely delete. Prose written for the planner becomes information for the student: "A4 is announced on the A3 sitting day" is teacher scheduling; "you sit A4 on Wed 12-23" is student information. A warning that "a lost Wednesday costs a whole unit stage" can stay if it helps students understand why attendance matters, but strip the contingency planning around it.

When the source marks future dates as provisional or projected, keep the dates and add one plain sentence that they may shift when the school publishes the calendar for that period; drop the operational instructions around them. When the source records a genuinely unresolved question that affects students (an unconfirmed date, a unit that may run in one of two forms), state what is decided and note briefly that the rest will be confirmed in class — never present it as teacher deliberation.

Lesson pages — any page whose path contains "lesson-plans/" — are restructured, not just re-voiced. The source is the teacher's run-of-show; the student version is a study page with four jobs: say what the lesson is, teach what it taught, support review afterward, and show the week's shape. Output lesson pages in exactly this order:
1. The H1 line, then the breadcrumb line under it, kept as written — except that a bare lesson code used as a link alias ("L02") becomes "Lesson 02". Then "## At a glance" with its table, kept exactly as written.
2. "## Overview" — one short prose paragraph, no bullets: what the lesson covers, what you produce (the deliverable, with its date), and what it feeds later. Fold the source's "Goal" into this, written to the student.
3. "## The ideas" — the heart of the page, usually its longest section. Every concept, term, distinction, mechanism, and named example the lesson teaches, restated as information to learn from directly rather than as a schedule of classroom moves: each term in bold where it is defined, a plain definition, then the example or evidence the lesson uses for it. Group with "###" subheadings when the lesson teaches more than one cluster. Everything teachable inside the source's session bullets belongs here; classroom mechanics (timings, grouping, board work, who collects what) do not.
4. "## Day by day" — one bullet per teaching day: "- **Tue 09-01.** " followed by one or two sentences saying what happens that day and any homework set. Keep every date, deadline, and homework fact. No minute counts, no materials logistics.
5. "## Assessment" — keep as the source has it (table and register link), reworded only where the voice rules require.
6. "## Review" — "Check you can:" followed by a short checklist. Each item is one sentence, starts with a verb, and names its concept or term outright. Derive the items from the source's objectives and taught content; add nothing new. This is the page's last section.
Do not output the source's "Objectives", "Goal", or "How it runs" headings on lesson pages; their content is absorbed into the structure above, and no student-actionable fact may be lost in the move. Where the source marks material as a spoken aside or a classroom bridge (for example Chinese-media comparisons), keep it as a brief aside at most; never promote it into a core example.

Every other page keeps its existing structure: rewrite the voice, never the shape.

Formatting rules:
- Keep the H1 title line exactly as written.
- Keep [[wikilinks]] exactly as they appear in the source — same target, same alias (one exception: lesson-code aliases in the breadcrumb line), including the [[path\\|alias]] form inside tables. Never invent a link that is not in the source. When restructuring moves a linked phrase, the link moves with it intact.
- Keep tables that carry student-facing facts; drop rows or columns that are teacher-only.
- Keep Obsidian callouts (lines starting "> [!note]", "> [!important]", etc.) only where their content survives; retitle them for students if needed.
- Keep the total length the same or shorter than the source; a restructured lesson page may run slightly longer only where stating an idea plainly needs the room. Never pad.
- Output only the rewritten markdown body — no preamble, no code fences, no commentary about what you changed.`

// Teacher-voice fragments that must not survive a rewrite. Checked against
// the model's output; one corrective retry, then a loud warning. This is a
// tripwire for review, not the privacy mechanism — that is sync.mjs's
// deterministic filter.
const LEAK_MARKERS = [
  // "the human" is this vault's own word for the teacher who curates it, so a
  // survival is a real leak. But it is also live subject matter in Oxbridge
  // (the human/machine line; Camus's "the human need"), where a bare /the
  // human/ made the retry unwinnable — the phrase is W09's own title, and in
  // Camus's case sits inside a verbatim quotation. Match only the meta senses:
  // possessive, a following date or decision-verb, or a preposition that takes
  // the curator as its object.
  /\bthe human['’]s\b/i,
  /\bthe human \d{4}-\d{2}-\d{2}/i,
  /\b(?:by|from|with|for|at|per|awaiting|asks?|asked|asking)\s+the human\b/i,
  /\bthe human\s+(?:retired|shelved|dropped|set|scoped|chose|decided|confirmed|expects?|expected|wants?|wanted|said|asked|curates?|prefers?|explicitly|has|had|later|before)\b/i,
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
  // Sealed exam papers (2026-08-04): sync.mjs redacts the L15/L16 paper
  // identities before the model sees them (SEALED_PAPERS). These fire only if
  // a future vault edit reintroduces a name in a phrasing that redaction
  // misses — the sitting depends on the extract staying unseen. Title-cased,
  // so studio prose about a lowercase "servant" cannot trip them.
  /\*Your Honor\*/,
  /\bServant\b/,
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
  // Style tripwires (prompt v2): the site voice bans em dashes and exclamation
  // marks in prose. Scoped to lines the model writes as prose — headings keep
  // their vault titles, table rows use "—" as the At-a-glance qualifier
  // separator, and blockquotes may quote sources verbatim, so all three pass.
  let styleHits = 0
  for (const line of output.split("\n")) {
    if (styleHits >= 5) break
    if (/^\s*[#>]/.test(line) || line.includes("|")) continue
    const clip = `"${line.trim().slice(0, 80)}"`
    if (line.includes("—")) {
      problems.push(`em dash in prose (use a comma, colon, or new sentence): ${clip}`)
      styleHits++
    } else if (line.replaceAll("![", "").includes("!")) {
      problems.push(`exclamation mark in prose: ${clip}`)
      styleHits++
    }
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
    // Streamed because the SDK requires it at this max_tokens; .finalMessage()
    // returns the same Message shape create() did. 32k, not 16k: adaptive
    // thinking counts toward the cap, and the 9607 resource library (the
    // longest page) hit 16k on the v3 rollout.
    const res = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      })
      .finalMessage()
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
  const { cachePath, disabled = false, log = console.log, skip = [] } = opts
  const cache = await loadCache(cachePath)

  // Pages written for students in the first place (Doğan's own assignment
  // briefs, authored in his voice) are published verbatim: the reframe would
  // replace that voice with the generic house voice for no gain. They are
  // pulled out before hashing, so they never miss the cache and never call the
  // model. Everything else still goes through the normal path.
  const authored = pages.filter((p) => skip.some((re) => re.test(p.rel)))
  if (authored.length) {
    pages = pages.filter((p) => !skip.some((re) => re.test(p.rel)))
    log(`reframe: ${authored.length} page(s) published as authored (student-voice source)`)
  }

  // REFRAME_PILOT=<regex over page rels>: stage a prompt change on a few pages
  // without re-rewriting the whole site. Pages matching the regex rewrite (and
  // cache) under the current prompt; any other page whose hash misses falls
  // back to its existing cache entry verbatim — no model call, no content/
  // diff — and keeps its old entry, so the eventual full run still re-rewrites
  // it. Manual runs only; auto-sync never sets it.
  const pilot = process.env.REFRAME_PILOT ? new RegExp(process.env.REFRAME_PILOT) : null

  const hits = []
  const misses = []
  const held = []
  for (const page of pages) {
    const hash = hashOf(page.body)
    const entry = cache.pages[page.rel]
    if (entry && entry.hash === hash) hits.push({ page, hash, body: entry.body })
    else if (pilot && !pilot.test(page.rel) && entry) held.push({ page, body: entry.body })
    else misses.push({ page, hash })
  }

  for (const { page, body } of hits) page.body = body
  for (const { page, body } of held) page.body = body
  if (held.length)
    log(
      `reframe: pilot (${process.env.REFRAME_PILOT}) — ${held.length} non-pilot page(s) ` +
        `reusing their prior rewrites; the full re-run happens on the next normal sync`,
    )

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

  return {
    cached: hits.length + held.length,
    rewritten: misses.length - kept.length,
    kept: kept.length,
  }
}
