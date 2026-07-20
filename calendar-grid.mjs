// Parse wiki/calendar.md's agenda table and render month-grid calendars — one per
// course, plus a combined view. Pure string/date work, imported by sync.mjs.
//
// The agenda table is the single source of truth (the same one the text list uses),
// so the grids never drift from it. Course is read from the Scope column's emoji.

export const COURSES = {
  "a-level": {
    name: "A Level Art & Design",
    overview: "classes/a-level-art-design/a-level-art-design",
    dir: "classes/a-level-art-design",
  },
  media: {
    name: "Media Studies",
    overview: "classes/media-studies/media-studies",
    dir: "classes/media-studies",
  },
  "art-app": {
    name: "Art Appreciation",
    overview: "classes/art-appreciation/art-appreciation",
    dir: "classes/art-appreciation",
  },
  pal: {
    name: "Pre A Level Art & Design",
    overview: "classes/pre-a-level-art-design/pre-a-level-art-design",
    dir: "classes/pre-a-level-art-design",
  },
  oxbridge: {
    name: "Oxbridge",
    overview: "classes/oxbridge/oxbridge",
    dir: "classes/oxbridge",
  },
}

// Semester 1 spans these months, in order.
const MONTHS = [
  [2026, 8],
  [2026, 9],
  [2026, 10],
  [2026, 11],
  [2027, 0],
]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function courseOf(scope) {
  if (scope.includes("🎨")) return "a-level"
  if (scope.includes("🎬")) return "media"
  if (scope.includes("🏛")) return "art-app"
  if (scope.includes("✏")) return "pal"
  if (scope.includes("🎓")) return "oxbridge"
  return "school"
}

function classify(scope, course, label) {
  if (scope.includes("🚫")) return "holiday"
  if (scope.includes("📝")) return "exam"
  if (course !== "school") {
    if (/\b(A[1-4]|EoT|CS\d+|HW\d+)\b/.test(label) || /deadline/i.test(label)) return "assessment"
    return "course-event"
  }
  if (scope.includes("⭐")) return "anchor"
  return "school-event"
}

// Split a table row on unescaped pipes — one event cell holds a `[[path\|alias]]`.
function splitRow(line) {
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())
  return cells
}

// A date cell is a single date, or a range on "→" / "/". The first token is always a
// full YYYY-MM-DD; the second may be full, MM-DD, or DD and resolves against it.
function parseDates(cell) {
  const clean = cell.replace(/\*\*/g, "").trim()
  const toks = clean.split(/\s*(?:→|\/)\s*/)
  const start = toks[0].match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (!start) return null
  let end = start
  if (toks[1]) {
    const t = toks[1].trim()
    const [sy, sm] = start.split("-")
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) end = t
    else if (/^\d{2}-\d{2}$/.test(t)) end = `${sy}-${t}`
    else if (/^\d{1,2}$/.test(t)) end = `${sy}-${sm}-${t.padStart(2, "0")}`
  }
  return { start, end }
}

function* eachDay(startISO, endISO) {
  const cur = new Date(startISO + "T00:00:00Z")
  const end = new Date(endISO + "T00:00:00Z")
  while (cur.getTime() <= end.getTime()) {
    yield cur.toISOString().slice(0, 10)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
}

export function parseAgenda(md) {
  const events = []
  let inTable = false
  for (const line of md.split("\n")) {
    if (line.startsWith("| Date |")) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (/^\|\s*-+/.test(line)) continue
    if (!line.startsWith("|")) break
    const c = splitRow(line)
    const dates = parseDates(c[0] || "")
    if (!dates) continue
    const scope = c[2] || ""
    const label = c[3] || ""
    const course = courseOf(scope)
    events.push({ ...dates, scope, label, course, kind: classify(scope, course, label) })
  }
  return events
}

// A short chip label: the assessment code where there is one, else the leading phrase.
function chipText(ev) {
  if (ev.kind === "assessment") {
    const m = ev.label.match(/\b(A[1-4]|EoT|CS\d+|HW\d+)\b/)
    if (m) return m[1]
    if (/deadline/i.test(ev.label)) return "Deadline"
  }
  if (ev.kind === "exam") return "Exam window"
  return ev.label
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\*\*/g, "")
    .split(/[—·(]/)[0]
    .trim()
    .slice(0, 22)
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function collect(events) {
  const chips = new Map()
  const shade = new Map()
  const push = (iso, ev) => {
    if (!chips.has(iso)) chips.set(iso, [])
    chips.get(iso).push(ev)
  }
  for (const ev of events) {
    const days = [...eachDay(ev.start, ev.end)]
    if (ev.kind === "holiday" || ev.kind === "exam") {
      for (const d of days) shade.set(d, ev.kind)
      push(days[0], ev) // label only the first day of a span
    } else {
      for (const d of days) push(d, ev)
    }
  }
  return { chips, shade }
}

function renderMonth(y, m, chips, shade) {
  const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Mon = 0
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  let cells = ""
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-day cal-day--empty"></div>`
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const sh = shade.get(iso)
    const weekend = (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7 >= 5
    const evs = (chips.get(iso) || [])
      .map(
        (e) =>
          `<span class="cal-ev cal-ev--${e.course} cal-ev--${e.kind}" title="${esc(
            e.label.replace(/\[\[[^\]|]*\|?|\]\]|\*\*/g, ""),
          )}">${esc(chipText(e))}</span>`,
      )
      .join("")
    const cls = ["cal-day", sh && `cal-day--${sh}`, weekend && "cal-day--weekend"]
      .filter(Boolean)
      .join(" ")
    cells += `<div class="${cls}"><span class="cal-daynum">${d}</span><div class="cal-evs">${evs}</div></div>`
  }
  const dows = DOW.map((x) => `<div class="cal-dow">${x}</div>`).join("")
  return `<div class="cal-month"><div class="cal-month-name">${MONTH_NAMES[m]} ${y}</div><div class="cal-grid">${dows}${cells}</div></div>`
}

export function renderCalendar(events) {
  const { chips, shade } = collect(events)
  return `<div class="cal">${MONTHS.map(([y, m]) => renderMonth(y, m, chips, shade)).join("")}</div>`
}

// School holidays, the exam window and the major term anchors are context on every
// calendar; assessments belong to their course.
const isContext = (ev) => ev.kind === "holiday" || ev.kind === "exam" || ev.kind === "anchor"

export function eventsForCourse(all, key) {
  return all.filter((ev) => ev.course === key || isContext(ev))
}

export function eventsCombined(all) {
  return all.filter((ev) => ev.course !== "school" || isContext(ev))
}

const COURSE_KEYS = {
  "a-level": "A Level Art",
  media: "Media",
  "art-app": "Art Appreciation",
  pal: "Pre A Level",
  oxbridge: "Oxbridge",
}

// The legend lists every course on the combined view, but only the one course on a
// per-course calendar — where the grid shows a single colour.
function legendHtml(mode) {
  const keys = mode ? [mode] : Object.keys(COURSE_KEYS)
  const courseChips = keys
    .map((k) => `<span class="cal-key cal-ev--${k}">${COURSE_KEYS[k]}</span>`)
    .join("")
  return `<div class="cal-legend">${courseChips}<span class="cal-key cal-key--holiday">holiday</span><span class="cal-key cal-key--exam">exam window</span></div>`
}

export function calendarBlock(events, mode) {
  const grid = renderCalendar(mode ? eventsForCourse(events, mode) : eventsCombined(events))
  return `${legendHtml(mode)}\n\n${grid}`
}

// A generated per-course calendar page (site-only — links use Quartz wikilinks).
export function coursePage(key, events) {
  const c = COURSES[key]
  const mine = events
    .filter((e) => e.course === key && (e.kind === "assessment" || e.kind === "course-event"))
    .sort((a, b) => a.start.localeCompare(b.start))
  const list = mine.length
    ? mine.map((e) => `- **${e.start}** — ${e.label.replace(/\*\*/g, "")}`).join("\n")
    : "_No assessments are scheduled for Semester 1._"
  const content = `---
title: "${c.name} — Calendar"
tags: [calendar]
---

# ${c.name} — Calendar

Semester 1, September 2026 – January 2027. This course's assessments are in colour; school holidays and the exam window are shaded, key term dates marked.

${calendarBlock(events, key)}

## Assessments

${list}

[[${c.overview}|← ${c.name}]] · [[calendar|All courses]]
`
  return { rel: `${c.dir}/course-calendar.md`, content }
}
