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

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s)

// Chip content. Register-derived events carry .code/.desc; agenda events carry a
// .label to mine. The single-month view has room for a short descriptor after the
// bold code ("A2 · C1 blog mid-point: posts 1–7").
function chipHtml(ev) {
  if (ev.code) {
    if (ev.kind === "lb") return `<strong>${ev.code}</strong>`
    const room = ev.kind === "attainment" ? 44 : 34
    return `<strong>${ev.code}</strong>${ev.desc ? ` ${esc(trunc(ev.desc, room))}` : ""}`
  }
  if (ev.kind === "assessment") {
    const m = ev.label.match(/\b(A[1-4]|EoT|CS\d+|HW\d+)\b/)
    const desc = ev.label
      .replace(/\[\[[^\]]*\]\]/g, "")
      .replace(/\*\*/g, "")
      .match(/\(([^)]+)\)/)?.[1]
      ?.split(/ — /)[0]
      ?.trim()
    if (m) return `<strong>${m[1]}</strong>${desc ? ` ${esc(desc.slice(0, 40))}` : ""}`
    if (/deadline/i.test(ev.label)) return "<strong>Deadline</strong>"
  }
  if (ev.kind === "exam") return "Exam window"
  return esc(
    ev.label
      .replace(/\[\[[^\]]*\]\]/g, "")
      .replace(/\*\*/g, "")
      .split(/[—·(]/)[0]
      .trim()
      .slice(0, 32),
  )
}

const chipTitle = (ev) =>
  esc(ev.code ? `${ev.code}: ${ev.desc}` : ev.label.replace(/\[\[[^\]|]*\|?|\]\]|\*\*/g, ""))

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Chip stacking order inside a day cell: assessments first, then class tasks,
// then participation postings; lesson labels render above all chips.
const WEIGHT = { assessment: 0, attainment: 0, "course-event": 1, cs: 2, lb: 3 }

function collect(events, units = []) {
  const chips = new Map()
  const shade = new Map()
  const lessons = new Map()
  const unitTint = new Map()
  const push = (map, iso, v) => {
    if (!map.has(iso)) map.set(iso, [])
    map.get(iso).push(v)
  }
  for (const ev of events) {
    const days = [...eachDay(ev.start, ev.end)]
    if (ev.kind === "holiday" || ev.kind === "exam") {
      for (const d of days) shade.set(d, ev.kind)
      push(chips, days[0], ev) // label only the first day of a span
    } else if (ev.kind === "lesson") {
      push(lessons, days[0], ev) // label where the lesson begins
    } else if (ev.kind === "cs" || ev.kind === "lb") {
      push(chips, days[days.length - 1], ev) // spans ("set → due") land on the due date
    } else if (ev.kind === "attainment") {
      push(chips, days[0], ev)
    } else {
      for (const d of days) push(chips, d, ev)
    }
  }
  for (const [iso, list] of chips) list.sort((a, b) => (WEIGHT[a.kind] ?? 1) - (WEIGHT[b.kind] ?? 1))
  // Unit spans tint their teaching days (weekends and holidays excluded at render),
  // alternating intensity so unit boundaries stay visible; label on the first day.
  units.forEach((u, i) => {
    let first = true
    for (const iso of eachDay(u.start, u.end)) {
      const dow = (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7
      if (dow >= 5) continue
      unitTint.set(iso, {
        p: i % 2,
        label: first ? `U${u.num}${u.title ? ` · ${u.title}` : ""}` : null,
      })
      first = false
    }
  })
  return { chips, shade, lessons, unitTint }
}

function renderMonth(y, m, data, idx, total) {
  const { chips, shade, lessons, unitTint } = data
  const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Mon = 0
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  let cells = ""
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-day cal-day--empty"></div>`
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const sh = shade.get(iso)
    const weekend = (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7 >= 5
    const tint = !sh && unitTint.get(iso)
    const unitLabel = tint?.label ? `<span class="cal-unitlabel">${esc(tint.label)}</span>` : ""
    const lessonLabels = (lessons.get(iso) || [])
      .map(
        (e) =>
          `<span class="cal-lesson" title="${esc(`${e.code}: ${e.desc}`)}">${esc(
            `${e.code}${e.desc ? ` ${trunc(e.desc, 24)}` : ""}`,
          )}</span>`,
      )
      .join("")
    const evs = (chips.get(iso) || [])
      .map(
        (e) =>
          `<span class="cal-ev cal-ev--${e.course ?? ""} cal-ev--${e.kind}" title="${chipTitle(e)}">${chipHtml(e)}</span>`,
      )
      .join("")
    const cls = [
      "cal-day",
      sh && `cal-day--${sh}`,
      weekend && "cal-day--weekend",
      tint && `cal-day--u${tint.p}`,
    ]
      .filter(Boolean)
      .join(" ")
    cells += `<div class="${cls}"><span class="cal-daynum">${d}</span><div class="cal-evs">${unitLabel}${lessonLabels}${evs}</div></div>`
  }
  const dows = DOW.map((x) => `<div class="cal-dow">${x}</div>`).join("")
  // Prev/next are <label>s driving the pager's radio inputs — no JS, so paging
  // works on first load and after Quartz's SPA navigation alike.
  const prev = idx > 0 ? `<label class="cal-nav" for="cal-m${idx - 1}">‹ ${MONTH_NAMES[MONTHS[idx - 1][1]]}</label>` : `<span class="cal-nav cal-nav--off"></span>`
  const next = idx < total - 1 ? `<label class="cal-nav" for="cal-m${idx + 1}">${MONTH_NAMES[MONTHS[idx + 1][1]]} ›</label>` : `<span class="cal-nav cal-nav--off"></span>`
  const head = `<div class="cal-month-head">${prev}<span class="cal-month-name">${MONTH_NAMES[m]} ${y}</span>${next}</div>`
  return `<div class="cal-month" data-m="${idx}">${head}<div class="cal-grid">${dows}${cells}</div></div>`
}

// One month visible at a time. The radio inputs sit as siblings before the month
// panels; CSS shows the panel matching the checked input.
export function renderCalendar(events, units = []) {
  const data = collect(events, units)
  const radios = MONTHS.map(
    (_, i) => `<input class="cal-radio" type="radio" name="cal-page" id="cal-m${i}"${i === 0 ? " checked" : ""}>`,
  ).join("")
  const months = MONTHS.map(([y, m], i) => renderMonth(y, m, data, i, MONTHS.length)).join("")
  return `<div class="cal cal-paged">${radios}${months}</div>`
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

// The hub legend lists every course; a per-course legend explains the levels of
// visual weight instead (solid attainment → outlined task → tiny LB → unit band).
function legendHtml(mode) {
  if (!mode) {
    const courseChips = Object.keys(COURSE_KEYS)
      .map((k) => `<span class="cal-key cal-ev--${k}">${COURSE_KEYS[k]}</span>`)
      .join("")
    return `<div class="cal-legend">${courseChips}<span class="cal-key cal-key--holiday">holiday</span><span class="cal-key cal-key--exam">exam window</span></div>`
  }
  return (
    `<div class="cal-legend">` +
    `<span class="cal-key cal-key--att">A1–A4 / EoT</span>` +
    `<span class="cal-key cal-key--cs">class task / homework</span>` +
    `<span class="cal-key cal-key--lb">LB</span>` +
    `<span class="cal-key cal-key--unit">unit</span>` +
    `<span class="cal-key cal-key--holiday">holiday</span>` +
    `<span class="cal-key cal-key--exam">exam window</span>` +
    `</div>`
  )
}

// Merge the agenda's course events with register/lesson-derived detail. Detail
// wins on a code+date collision (its descriptions are richer); agenda-only items
// survive — PAL's EoT lives in register prose, not a table, so only the agenda
// carries it as an event.
export function mergeCourseEvents(agendaCourseEvents, detail) {
  const have = new Set(detail.map((d) => `${d.code}|${d.start}`))
  const kept = agendaCourseEvents.filter((ev) => {
    const code = ev.label?.match(/\b(A[1-4]|EoT|CS\d+|HW\d+|LB\d+)\b/)?.[1]
    return !code || !have.has(`${code}|${ev.start}`)
  })
  return [...kept, ...detail]
}

export function calendarBlock(events, mode, detail = null) {
  let grid
  if (mode) {
    const context = events.filter(isContext)
    const own = events.filter((ev) => ev.course === mode && !isContext(ev))
    const merged = detail
      ? mergeCourseEvents(own, detail.events).map((ev) => ({ ...ev, course: mode }))
      : own
    grid = renderCalendar([...context, ...merged], detail?.units ?? [])
  } else {
    grid = renderCalendar(eventsCombined(events))
  }
  const wrap = mode ? ` cal--${mode}` : ""
  return `<div class="calwrap${wrap}">${legendHtml(mode)}\n${grid}</div>`
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const dayName = (iso) => WEEKDAY[new Date(iso + "T00:00:00Z").getUTCDay()]

// A generated per-course calendar page (site-only — links use Quartz wikilinks).
export function coursePage(key, events, detail) {
  const c = COURSES[key]
  const own = events.filter((ev) => ev.course === key && !isContext(ev))
  const all = detail ? mergeCourseEvents(own, detail.events) : own

  const line = (e) => {
    const code = e.code ?? e.label?.match(/\b(A[1-4]|EoT|CS\d+|HW\d+)\b/)?.[1]
    const desc = e.desc ?? e.label?.replace(/\*\*/g, "")
    const due = e.kind === "cs" && e.end !== e.start ? `${e.end} (due)` : e.start
    return `- **${dayName(due.slice(0, 10))} ${due}** — ${code ? `**${code}**` : ""} ${desc ?? ""}`.trimEnd()
  }
  const sorted = (kinds) =>
    all
      .filter((e) => kinds.includes(e.kind))
      .sort((a, b) => (a.end ?? a.start).localeCompare(b.end ?? b.start))

  const attainments = sorted(["attainment", "assessment", "course-event"])
  const tasks = sorted(["cs"])
  const attList = attainments.length
    ? attainments.map(line).join("\n")
    : "_No assessments are scheduled for Semester 1._"
  const taskList = tasks.length ? tasks.map(line).join("\n") : ""

  const content = `---
title: "${c.name} — Calendar"
tags: [calendar]
---

# ${c.name} — Calendar

Semester 1, September 2026 – January 2027. Solid chips are the graded attainments; outlined chips are class tasks and homework; **LB** marks participation postings. The tinted band running under the days is the unit you're in, with each lesson labelled where it begins. Holidays and the exam window are shaded.

${calendarBlock(events, key, detail)}

## Attainments & End of Term

${attList}
${
  taskList
    ? `
## Class tasks & homework

${taskList}
`
    : ""
}
[[${c.overview}|← ${c.name}]] · [[calendar|All courses]]
`
  return { rel: `${c.dir}/course-calendar.md`, content }
}
