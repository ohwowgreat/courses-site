// Parse per-course detail events from the vault: every graded item from the
// assessment registers (A/EoT, CS/HW, LB), lesson runs from the lesson plans'
// "At a glance" Dates rows, and PAL's session rows from its unit week-tables.
// Unit spans are derived from the lessons that belong to them.
//
// Everything lands in one shape: { kind, code, desc, start, end, unit, href }.
// kinds: attainment | cs | lb | lesson  (+ unit spans returned separately)
//
// href is the page the item came from, as a content-root-relative slug — the
// calendar links every chip, lesson label and unit bar back to its source page.

import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

// Semester 1 window — register rows outside it (9479 S2–S4) are dropped.
const WIN_START = "2026-08-15"
const WIN_END = "2027-02-10"

// MM-DD tokens carry no year: the semester runs Sep 2026 → Jan 2027.
const resolveYear = (mmdd) => (+mmdd.slice(0, 2) >= 8 ? `2026-${mmdd}` : `2027-${mmdd}`)

function dateTokens(text) {
  const out = []
  const re = /(\d{4}-\d{2}-\d{2})|\b(\d{2}-\d{2})\b/g
  let m
  while ((m = re.exec(text))) out.push(m[1] ?? resolveYear(m[2]))
  return out
}

const stripMd = (s) =>
  s
    .replace(/\[\[[^\]|]*\\?\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\*\*/g, "")
    .trim()

function splitRow(line) {
  const cells = line.split(/(?<!\\)\|/)
  if (cells.length && cells[0].trim() === "") cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop()
  return cells.map((c) => c.trim())
}

// ── Registers ────────────────────────────────────────────────────────────────
// Generic over the four register styles: find each table's date and description
// columns by header name, then take any row whose first cell is a code.

function parseRegister(md, href) {
  const events = []
  const lines = md.split("\n")
  let dateCol = -1
  let descCol = -1
  for (const line of lines) {
    if (!line.startsWith("|")) continue
    const cells = splitRow(line)
    if (/^[\s:|-]+$/.test(cells.join("|"))) continue
    const headerish = cells.findIndex((c) => /^(date\b|sits\b|wednesday\b)/i.test(stripMd(c)))
    if (headerish > 0) {
      dateCol = headerish
      descCol = cells.findIndex((c) => /task|what|milestone|session|covers/i.test(c))
      continue
    }
    const code = stripMd(cells[0] ?? "").match(/^(A[1-6]|EoT|CS\d+|HW\d+|LB\d+)$/)?.[1]
    if (!code || dateCol < 0) continue
    const dates = dateTokens(cells[dateCol] ?? "")
    if (!dates.length) continue
    const start = dates[0]
    // Spanned rows ("set 09-30 → due 10-09"): the due date is what students act on.
    const end = dates[dates.length - 1] >= start ? dates[dates.length - 1] : start
    const kind = /^(A\d|EoT)$/.test(code) ? "attainment" : code.startsWith("LB") ? "lb" : "cs"
    const desc = stripMd(cells[descCol >= 0 ? descCol : cells.length - 1] ?? "")
    events.push({ kind, code, desc, start, end, href })
  }
  return events
}

// ── Lesson plans ─────────────────────────────────────────────────────────────

function parseLesson(md, file, href) {
  const n = file.match(/lesson-(\d+)/)?.[1]
  if (!n) return null
  const title = md.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? ""
  const name = title.match(/Lesson \d+[:.]?\s*(.*)/i)?.[1]?.replace(/^[—-]\s*/, "") ?? ""
  const glance = md.match(/## At a glance([\s\S]*?)(?=\n## )/)?.[1] ?? ""
  const datesRow = glance.match(/^\|\s*Dates\s*\|(.+)\|/m)?.[1]
  if (!datesRow) return null
  const dates = dateTokens(datesRow)
  if (!dates.length) return null
  dates.sort()
  // Unit: every lesson links its unit page (frontmatter related / breadcrumb),
  // which is unambiguous — prose mentioning another unit ("carries the U4 demand
  // signal") must not win. Fall back to a dedicated Unit row in the at-a-glance
  // table for lessons that link no unit page.
  const unit = +(
    md.match(/s1-unit-(\d)/)?.[1] ??
    glance.match(/^\|\s*Unit\s*\|[^|]*?\bU?(\d)/im)?.[1] ??
    0
  )
  return {
    kind: "lesson",
    code: `L${n.padStart(2, "0")}`,
    desc: name,
    start: dates[0],
    end: dates[dates.length - 1],
    unit,
    href,
  }
}

// ── PAL unit week-tables ─────────────────────────────────────────────────────
// | W7 | 2026-10-14 | U2·L1 · S6 | Framing, viewpoint, rule of thirds… | HW1 due |

function parseWeekTable(md, unitNum, href) {
  const events = []
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*W\d+\s*\|\s*(\d{4}-\d{2}-\d{2})[^|]*\|\s*([^|]*)\|\s*([^|]*)\|/)
    if (!m) continue
    const lessonCell = stripMd(m[2])
    if (!/U\d·L\d/.test(lessonCell)) continue // holiday / no-class rows
    events.push({
      kind: "lesson",
      code: lessonCell.match(/U\d·L\d+/)[0],
      desc: stripMd(m[3]).split(";")[0],
      start: m[1],
      end: m[1],
      unit: unitNum,
      href,
    })
  }
  return events
}

// ── Per-course assembly ──────────────────────────────────────────────────────

async function safeList(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
}

// Both ends must land in the semester: later semesters reuse bare MM-DD tokens
// ("Mon 2027-09-27 → Thu 09-30"), which resolveYear pulls back into 2026 and
// would otherwise smuggle an S3 lesson into the S1 calendar.
const inWindow = (ev) =>
  ev.start >= WIN_START && ev.start <= WIN_END && ev.end >= WIN_START && ev.end <= WIN_END

export async function courseDetailEvents(vault, courseDir) {
  const root = join(vault, courseDir)
  const events = []
  // Pages are published under the same names they carry in the vault, so a slug
  // is just the course dir + subfolder + basename.
  const slug = (sub, f) => `${courseDir}/${sub}/${f.replace(/\.md$/, "")}`

  let register = null
  for (const f of await safeList(join(root, "assessments"))) {
    const href = slug("assessments", f)
    if (/s1-assessments/.test(f) || !register) register = href
    events.push(...parseRegister(await readFile(join(root, "assessments", f), "utf8"), href))
  }

  for (const f of await safeList(join(root, "lesson-plans"))) {
    // Semester 1 only — S2–S4 lesson plans carry dates this calendar can misread.
    if (!/s1-lesson-\d+/.test(f)) continue
    const ev = parseLesson(
      await readFile(join(root, "lesson-plans", f), "utf8"),
      f,
      slug("lesson-plans", f),
    )
    if (ev) events.push(ev)
  }

  // Unit titles and pages, plus PAL's sessions (its lessons live in the unit
  // week-tables).
  const unitTitles = new Map()
  const unitHrefs = new Map()
  for (const f of await safeList(join(root, "unit-plans"))) {
    const um = f.match(/s1-unit-(\d)/)
    if (!um) continue
    const md = await readFile(join(root, "unit-plans", f), "utf8")
    const title = md.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? ""
    const href = slug("unit-plans", f)
    unitTitles.set(+um[1], title.match(/Unit \d+[:.]?\s*(.*)/i)?.[1] ?? title)
    unitHrefs.set(+um[1], href)
    if (courseDir.includes("pre-a-level")) events.push(...parseWeekTable(md, +um[1], href))
  }

  // Unit spans from their lessons' dates — from the in-window lessons only, so a
  // stray later-semester date can't stretch a unit across the whole calendar.
  const inSemester = events.filter(inWindow)
  const byUnit = new Map()
  for (const ev of inSemester) {
    if (ev.kind !== "lesson" || !ev.unit) continue
    const u = byUnit.get(ev.unit) ?? { start: ev.start, end: ev.end }
    u.start = ev.start < u.start ? ev.start : u.start
    u.end = ev.end > u.end ? ev.end : u.end
    byUnit.set(ev.unit, u)
  }
  const units = [...byUnit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, span]) => ({
      ...span,
      num: n,
      title: unitTitles.get(n) ?? "",
      href: unitHrefs.get(n) ?? null,
    }))

  return { events: inSemester, units, register }
}
