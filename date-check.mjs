// date-check.mjs — assessment-date consistency across the vault's layers.
//
// Dates in this vault are prose, written wherever a page needs them to read
// standalone, so nothing propagates a change: the July 2026 redraw moved three
// Art Appreciation sittings in the register and the calendar-events files but
// missed the lesson bodies, and the site published both versions. This check
// makes that drift loud instead of silent.
//
// The register is the declared truth. For every assessment code it carries,
// each register row's dates (sit, announced, returned — whatever the row
// holds) form that code's allowed set. Three comparisons follow:
//   - prose: any lesson/unit/brief line mentioning a code next to a date that
//     appears in none of the code's register rows;
//   - calendar-events/: any event file whose filename date disagrees;
//   - blockquote lines are skipped everywhere — the registers' move tables
//     deliberately show superseded dates, and quoted sources stay verbatim.
//
// Advisory by design: sync.mjs prints findings as plain lines (never ⚠), so
// they surface in every auto-sync log without blocking a publish. Also runs
// standalone as a vault lint: node date-check.mjs [path-to-wiki].

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

// Codes worth checking, plus per-course aliases used by prose and the
// calendar-events filenames ("Retrospective" is Art Appreciation's EoT;
// media's A3 event is filed under the thing it actually is, "C1 complete").
const CODE = /\b(A[1-5]|CS\d{1,2}|HW\d|SB\d|EoT)\b/g
const ALIASES = [
  [/\bRetrospective\b/gi, "EoT"],
  [/\bC1 complete\b/gi, "A3"],
  [/\bthe Final\b/g, "EoT"],
]

// Words that break the bond between a nearby code and a date: "A1 feeds the
// mid-term grades (due Thu 2026-10-29)" dates the grades, not A1; "A4
// returned Mon 12-21" is a return date the registers do not track; "if the
// field trip takes Friday, A3 slips" is contingency, not schedule. Tuned on
// the live corpus; extend when a false positive appears.
const UNBOUND =
  /mid-?term|grade|window|cutoff|deadline|notice|calendar|feeds|mock|carry|return|review|marking|holiday|break|week before|days before|slips?|TBC|field trip|if (the|it|this|day)|predecessor|prior|self-assessment|goes? (back )?up|on the wall|exam week|feedback|comes back/i

// In art courses A1–A5 are also paper sizes and material names ("three A5
// drawings", "the A5 Drawing Guide", "A3 mind map"). A code followed by a
// making word is paper, not an assessment.
export const PAPER_BEFORE = /(?:sides? of|sheets? of|piece of|printed at)\s+$/i
export const PAPER =
  /^\s*(?:-?\s*)(?:[a-z]+[- ])?(?:paper|sheets?|cards?|stock|cartridge|size|double|drawings?|stud(?:y|ies)|mind map|bookmark|landscape|portrait|sketch|Drawing Guide|boards?\b)/i

// All dates in a string as {iso, index}. Short forms (MM-DD, "19 Nov") take
// the school year: months Aug–Dec belong to startYear, Jan–Jul to the next.
// Dates before the school year opens (provenance stamps, ingest notes) are
// dropped: they are never assessment dates.
export function datesIn(text, startYear) {
  const found = []
  const seen = (y, m, d, index) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    if (iso < `${startYear}-08-01`) return
    found.push({ iso, index })
  }
  const inferYear = (m) => (m >= 8 ? startYear : startYear + 1)
  let m
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/g
  while ((m = iso.exec(text))) seen(+m[1], +m[2], +m[3], m.index)
  const short = /(?<!20\d\d-)(?<!\d)(\d\d)-(\d\d)\b(?!-)/g
  while ((m = short.exec(text))) seen(inferYear(+m[1]), +m[1], +m[2], m.index)
  const dayMon = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/gi
  while ((m = dayMon.exec(text)))
    seen(inferYear(MONTHS[m[2].toLowerCase()]), MONTHS[m[2].toLowerCase()], +m[1], m.index)
  const monDay = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{1,2})\b/gi
  while ((m = monDay.exec(text)))
    seen(inferYear(MONTHS[m[1].toLowerCase()]), MONTHS[m[1].toLowerCase()], +m[2], m.index)
  return found
}

// Week tables write ranges as "09-07 → 11": a register date inside the range
// satisfies any code on the row.
export function rangesIn(text, startYear) {
  const ranges = []
  for (const m of text.matchAll(/\b(\d\d)-(\d\d)\s*(?:→|->|–|to|\/)\s*(\d{1,2})\b/g)) {
    const y = +m[1] >= 8 ? startYear : startYear + 1
    const mm = String(+m[1]).padStart(2, "0")
    ranges.push({
      from: `${y}-${mm}-${String(+m[2]).padStart(2, "0")}`,
      to: `${y}-${mm}-${String(+m[3]).padStart(2, "0")}`,
    })
  }
  return ranges
}

const applyAliases = (text) => ALIASES.reduce((t, [re, code]) => t.replace(re, code), text)

// The school year a file's own full dates imply (most common start-ish year).
function startYearOf(text) {
  const years = {}
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-\d\d\b/g)) {
    const y = +m[2] >= 8 ? +m[1] : +m[1] - 1
    years[y] = (years[y] ?? 0) + 1
  }
  const best = Object.entries(years).sort((a, b) => b[1] - a[1])[0]
  return best ? +best[0] : 2026
}

// register text → { A1: Set<iso>, … } from non-blockquote lines only.
export function registerAllowed(text) {
  const startYear = startYearOf(text)
  const allowed = {}
  for (const line of text.split("\n")) {
    if (/^\s*>/.test(line)) continue
    const aliased = applyAliases(line)
    const codes = [
      ...new Set(
        [...aliased.matchAll(CODE)]
          .filter(
            (m) =>
              !PAPER.test(aliased.slice(m.index + m[1].length)) &&
              !PAPER_BEFORE.test(aliased.slice(0, m.index)),
          )
          .map((m) => m[1]),
      ),
    ]
    if (!codes.length) continue
    const dates = datesIn(line, startYear)
    if (!dates.length) continue
    for (const code of codes) {
      allowed[code] ??= new Set()
      for (const d of dates) allowed[code].add(d.iso)
    }
  }
  return allowed
}

// One page's lines against a register's allowed sets. Each date on a line
// binds to its nearest assessment code (a date beside A3 is not evidence
// about A2 mentioned earlier in the sentence). A finding needs a bound date
// within 80 characters of a code the register knows, no allowed date for
// that code anywhere on the line, no week-range covering an allowed date,
// and no unbinding context between code and date.
export function checkProse(rel, text, allowed, startYear) {
  const findings = []
  for (const rawLine of text.split("\n")) {
    if (/^\s*>/.test(rawLine)) continue
    const line = applyAliases(rawLine)
    const codes = [...line.matchAll(CODE)]
      .filter(
        (m) =>
          !PAPER.test(line.slice(m.index + m[1].length)) &&
          !PAPER_BEFORE.test(line.slice(0, m.index)),
      )
      .map((m) => ({ code: m[1], index: m.index }))
    if (!codes.length) continue
    const dates = datesIn(line, startYear)
    if (!dates.length) continue
    const ranges = rangesIn(line, startYear)
    // Context words anywhere on the line unbind it: return days, marking
    // windows, contingency talk. Only lines that read as schedule survive.
    if (UNBOUND.test(line)) continue
    // A day-run line ("**Day 2 · Tue 17 Nov**", "### D1 — Mon 12-21",
    // "- **Fri 09-04.**") is governed by its leading date: bind without a
    // distance limit there, since the schedule is the line's whole subject.
    const dayLine =
      /^\s*-?\s*\*{0,2}Day\s+\d/i.test(line) ||
      /^\s*#{2,3}\s*D\d\b/.test(line) ||
      /^\s*-\s*\*\*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(line)
    const reach = dayLine ? Infinity : 80
    // On a day line, a code only claims the date when a scheduling verb sits
    // beside it: "**A3 sits**" is a claim, "direct practice for A1" is not.
    const SCHED =
      /\b(?:sits?|sat|collect(?:ed|s)?|due|announced|submit(?:ted|s)?|posted|checks?)\b/i
    const claiming = dayLine
      ? codes.filter((c) =>
          SCHED.test(line.slice(Math.max(0, c.index - 30), c.index + c.code.length + 30)),
        )
      : codes
    const perCode = new Map()
    for (const d of dates) {
      // A date valid for any code on this line is spoken for; drift means a
      // date that belongs to nobody here.
      if (codes.some((c) => allowed[c.code]?.has(d.iso))) continue
      let best = null
      for (const c of claiming) {
        const dist = Math.abs(c.index - d.index)
        if (dist <= reach && (!best || dist < best.dist)) best = { c, dist }
      }
      if (!best) continue
      if (!perCode.has(best.c.code)) perCode.set(best.c.code, [])
      perCode.get(best.c.code).push(d.iso)
    }
    for (const [code, bound] of perCode) {
      if (!allowed[code]) continue
      const ok = [...allowed[code]]
      if (dates.some((d) => allowed[code].has(d.iso))) continue
      if (ranges.some((r) => ok.some((d) => d >= r.from && d <= r.to))) continue
      findings.push(
        `date check: ${rel} — ${code} near "${rawLine.trim().slice(0, 70)}" has ` +
          `${[...new Set(bound)].join(", ")}; register has ${ok.join(", ")}`,
      )
    }
  }
  return findings
}

const EVENT_DIRS = {
  media: "media-studies",
  "art-appreciation": "art-appreciation",
  "pre-a-level": "pre-a-level-art-design",
  "a-level": "a-level-art-design",
}

export async function checkDates(vaultWiki) {
  const findings = []
  const classesDir = join(vaultWiki, "classes")
  const courses = (await readdir(classesDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  // course → semester key ("s1"…) → allowed sets; single-register courses use "s1".
  const registers = {}
  for (const course of courses) {
    const dir = join(classesDir, course, "assessments")
    const files = await readdir(dir).catch(() => [])
    for (const f of files.filter((f) => f.endsWith("-assessments.md"))) {
      const sem = f.match(/-(s\d)-assessments\.md$/)?.[1] ?? "s1"
      const text = await readFile(join(dir, f), "utf8")
      ;(registers[course] ??= {})[sem] = {
        allowed: registerAllowed(text),
        startYear: startYearOf(text),
      }
    }
  }

  // Prose: every course page outside the registers themselves.
  for (const course of courses) {
    const sems = registers[course]
    if (!sems) continue
    const multi = Object.keys(sems).length > 1
    const stack = [join(classesDir, course)]
    while (stack.length) {
      const dir = stack.pop()
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (
          e.name.endsWith(".md") &&
          !e.name.endsWith("-assessments.md") &&
          // Historical archives describe past years; their dates are records.
          !/prior|legacy/.test(e.name)
        ) {
          const sem = multi ? e.name.match(/-(s\d)-/)?.[1] : Object.keys(sems)[0]
          if (!sem || !sems[sem]) continue // no register to bind to — skip
          const rel = p.slice(vaultWiki.length + 1)
          const text = await readFile(p, "utf8")
          findings.push(...checkProse(rel, text, sems[sem].allowed, sems[sem].startYear))
        }
      }
    }
  }

  // calendar-events/: filename dates against any of the course's registers.
  const eventsRoot = join(vaultWiki, "..", "calendar-events")
  for (const [folder, course] of Object.entries(EVENT_DIRS)) {
    const sems = registers[course]
    if (!sems) continue
    for (const f of await readdir(join(eventsRoot, folder)).catch(() => [])) {
      const m = f.match(/^(\d{4}-\d\d-\d\d) (.+)\.md$/)
      if (!m) continue
      const code = applyAliases(m[2]).match(/\b(A[1-5]|EoT)\b/)?.[1]
      if (!code) continue
      const entries = Object.values(sems).filter((s) => s.allowed[code])
      if (!entries.length) continue
      if (entries.some((s) => s.allowed[code].has(m[1]))) continue
      const known = entries.flatMap((s) => [...s.allowed[code]])
      findings.push(
        `date check: calendar-events/${folder}/${f} — ${code} filename date ${m[1]}; ` +
          `register has ${known.join(", ")}`,
      )
    }
  }
  return findings
}

// Standalone vault lint: node date-check.mjs [path-to-wiki]
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const wiki = process.argv[2] ?? "/Users/dogan/Documents/Vaults/Courses/wiki"
  const findings = await checkDates(wiki)
  for (const f of findings) console.log(f)
  console.log(`date check: ${findings.length} finding(s) across the vault`)
}
