// Parse per-course detail events from the vault: every graded item from the
// assessment registers (A/EoT, CS/HW, LB), lesson runs from the lesson plans'
// "At a glance" Dates rows, and PAL's session rows from its unit week-tables.
// Unit spans are derived from the lessons that belong to them.
//
// Everything lands in one shape: { kind, code, desc, start, end, unit }.
// kinds: attainment | cs | lb | lesson  (+ unit spans returned separately)

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

function parseRegister(md) {
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
    events.push({ kind, code, desc, start, end })
  }
  return events
}

// ── Lesson plans ─────────────────────────────────────────────────────────────

function parseLesson(md, file) {
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
  // Unit: named in the at-a-glance table when present; otherwise every lesson
  // links its unit page (frontmatter related / breadcrumb), so fall back to that.
  const unit = +(
    glance.match(/\bU(\d)\b|Unit (\d)/)?.slice(1).find(Boolean) ??
    md.match(/s1-unit-(\d)/)?.[1] ??
    0
  )
  return {
    kind: "lesson",
    code: `L${n.padStart(2, "0")}`,
    desc: name,
    start: dates[0],
    end: dates[dates.length - 1],
    unit,
  }
}

// ── PAL unit week-tables ─────────────────────────────────────────────────────
// | W7 | 2026-10-14 | U2·L1 · S6 | Framing, viewpoint, rule of thirds… | HW1 due |

function parseWeekTable(md, unitNum) {
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

const inWindow = (ev) => ev.start >= WIN_START && ev.start <= WIN_END

export async function courseDetailEvents(vault, courseDir) {
  const root = join(vault, courseDir)
  const events = []

  for (const f of await safeList(join(root, "assessments")))
    events.push(...parseRegister(await readFile(join(root, "assessments", f), "utf8")))

  for (const f of await safeList(join(root, "lesson-plans"))) {
    if (!/lesson-\d+/.test(f)) continue
    const ev = parseLesson(await readFile(join(root, "lesson-plans", f), "utf8"), f)
    if (ev) events.push(ev)
  }

  // Unit titles, and PAL's sessions (its lessons live in the unit week-tables).
  const unitTitles = new Map()
  for (const f of await safeList(join(root, "unit-plans"))) {
    const um = f.match(/s1-unit-(\d)/)
    if (!um) continue
    const md = await readFile(join(root, "unit-plans", f), "utf8")
    const title = md.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? ""
    unitTitles.set(+um[1], title.match(/Unit \d+[:.]?\s*(.*)/i)?.[1] ?? title)
    if (courseDir.includes("pre-a-level")) events.push(...parseWeekTable(md, +um[1]))
  }

  // Unit spans from their lessons' dates.
  const byUnit = new Map()
  for (const ev of events) {
    if (ev.kind !== "lesson" || !ev.unit) continue
    const u = byUnit.get(ev.unit) ?? { start: ev.start, end: ev.end }
    u.start = ev.start < u.start ? ev.start : u.start
    u.end = ev.end > u.end ? ev.end : u.end
    byUnit.set(ev.unit, u)
  }
  const units = [...byUnit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, span]) => ({ ...span, num: n, title: unitTitles.get(n) ?? "" }))

  return { events: events.filter(inWindow), units }
}
