// Parse wiki/calendar.md's agenda table and render month-grid calendars — one per
// course, plus a combined view. Pure string/date work, imported by sync.mjs.
//
// The agenda table is the single source of truth (the same one the text list uses),
// so the grids never drift from it. Course is read from the Scope column's emoji.

// `cohort` is who the course is for, `code` the syllabus it sits on. Split rather than
// one string because the overview strip sets the code as the cell's sub-line: as one
// value, "Grade 11 · CIE 9607" wrapped to two lines in a 162px cell. Two courses have no
// syllabus code, and stripHtml drops an empty note.
export const COURSES = {
  "a-level": {
    name: "A Level Art & Design",
    cohort: "Grade 11 → 12",
    code: "CIE 9479",
    overview: "classes/a-level-art-design/a-level-art-design",
    dir: "classes/a-level-art-design",
  },
  media: {
    name: "Media Studies",
    cohort: "Grade 11",
    code: "CIE 9607",
    overview: "classes/media-studies/media-studies",
    dir: "classes/media-studies",
  },
  "art-app": {
    name: "Art Appreciation",
    cohort: "Grade 11 + 12",
    code: "Elective",
    overview: "classes/art-appreciation/art-appreciation",
    dir: "classes/art-appreciation",
  },
  pal: {
    name: "Pre A Level Art & Design",
    cohort: "Grade 10",
    code: "",
    overview: "classes/pre-a-level-art-design/pre-a-level-art-design",
    dir: "classes/pre-a-level-art-design",
  },
  oxbridge: {
    name: "Oxbridge",
    cohort: "Grade 12",
    code: "",
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
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
  const cells = line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((c) => c.trim())
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

// Every mark on the grid is a link to the page it came from — an <a> when the
// item knows its page, an inert <span> when it doesn't. Hrefs are content-root
// relative slugs; Quartz's link transformer relativizes them per page. `inner`
// and `title` arrive escaped (chipHtml/chipTitle do their own).
function tag(cls, inner, { href, title, style } = {}) {
  const attrs =
    `class="${cls}"` + (title ? ` title="${title}"` : "") + (style ? ` style="${style}"` : "")
  return href ? `<a ${attrs} href="${esc(href)}">${inner}</a>` : `<span ${attrs}>${inner}</span>`
}

// Chip stacking order inside a day cell: assessments first, then class tasks,
// then participation postings; lesson labels render above all chips.
const WEIGHT = { assessment: 0, attainment: 0, "course-event": 1, cs: 2, lb: 3 }

function collect(events, units = []) {
  const chips = new Map()
  const shade = new Map()
  const lessons = new Map()
  const unitOf = new Map()
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
  for (const [iso, list] of chips)
    list.sort((a, b) => (WEIGHT[a.kind] ?? 1) - (WEIGHT[b.kind] ?? 1))
  // A unit claims its teaching days — weekends, holidays and the exam window are
  // not taught, so they break the bar rather than sit under it. Each unit carries
  // its ramp position (i) and its first taught day, which the renderer uses to
  // give the opening segment its spine.
  const bars = units.map((u, i) => ({ ...u, i, firstDay: null }))
  for (const u of bars) {
    for (const iso of eachDay(u.start, u.end)) {
      const dow = (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7
      if (dow >= 5 || shade.has(iso)) continue
      u.firstDay ??= iso
      unitOf.set(iso, u)
    }
  }
  return { chips, shade, lessons, unitOf, hasUnits: bars.length > 0 }
}

// The bar track above a week's days: one segment per run of consecutive taught
// days, placed on a nested 7-column grid that mirrors the day columns. A unit
// therefore reads as a continuous band across the dates it spans, breaking where
// teaching does.
function unitBarRow(week, data) {
  const runs = []
  week.forEach((cell, i) => {
    const u = cell && data.unitOf.get(cell.iso)
    if (!u) return
    const last = runs[runs.length - 1]
    if (last && last.u === u && last.col + last.span === i + 1) {
      last.span++
      return
    }
    runs.push({ u, col: i + 1, span: 1, from: cell.iso })
  })
  const bars = runs
    .map(({ u, col, span, from }) => {
      const label = span > 1 && u.title ? `U${u.num} · ${u.title}` : `U${u.num}`
      const cls = [
        "cal-bar",
        `cal-bar--u${Math.min(u.i, 5)}`,
        from === u.firstDay && "cal-bar--open",
      ]
        .filter(Boolean)
        .join(" ")
      return tag(cls, esc(label), {
        href: u.href,
        title: esc(`Unit ${u.num}${u.title ? `: ${u.title}` : ""} · ${u.start} → ${u.end}`),
        style: `grid-column:${col}/span ${span}`,
      })
    })
    .join("")
  return `<div class="cal-bars">${bars}</div>`
}

function dayCell(cell, data) {
  if (!cell) return `<div class="cal-day cal-day--empty"></div>`
  const { d, iso, weekend } = cell
  const sh = data.shade.get(iso)
  const lessonLabels = (data.lessons.get(iso) || [])
    .map((e) =>
      tag("cal-lesson", esc(`${e.code}${e.desc ? ` ${trunc(e.desc, 24)}` : ""}`), {
        href: e.href,
        title: esc(`${e.code}: ${e.desc}`),
      }),
    )
    .join("")
  const evs = (data.chips.get(iso) || [])
    .map((e) =>
      tag(`cal-ev cal-ev--${e.course ?? ""} cal-ev--${e.kind}`, chipHtml(e), {
        href: e.href,
        title: chipTitle(e),
      }),
    )
    .join("")
  const cls = ["cal-day", sh && `cal-day--${sh}`, weekend && "cal-day--weekend"]
    .filter(Boolean)
    .join(" ")
  return `<div class="${cls}"><span class="cal-daynum">${d}</span><div class="cal-evs">${lessonLabels}${evs}</div></div>`
}

function renderMonth(y, m, data, idx, total) {
  const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Mon = 0
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  // Pad to whole weeks so each row is a Mon–Sun band the bar track can span.
  const slots = Array.from({ length: startDow }, () => null)
  for (let d = 1; d <= daysInMonth; d++) {
    slots.push({
      d,
      iso: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      weekend: (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7 >= 5,
    })
  }
  while (slots.length % 7) slots.push(null)

  let cells = ""
  for (let w = 0; w < slots.length; w += 7) {
    const week = slots.slice(w, w + 7)
    if (data.hasUnits) cells += unitBarRow(week, data)
    cells += week.map((cell) => dayCell(cell, data)).join("")
  }
  const dows = DOW.map((x) => `<div class="cal-dow">${x}</div>`).join("")
  // Prev/next are <label>s driving the pager's radio inputs — no JS, so paging
  // works on first load and after Quartz's SPA navigation alike.
  const prev =
    idx > 0
      ? `<label class="cal-nav" for="cal-m${idx - 1}">‹ ${MONTH_NAMES[MONTHS[idx - 1][1]]}</label>`
      : `<span class="cal-nav cal-nav--off"></span>`
  const next =
    idx < total - 1
      ? `<label class="cal-nav" for="cal-m${idx + 1}">${MONTH_NAMES[MONTHS[idx + 1][1]]} ›</label>`
      : `<span class="cal-nav cal-nav--off"></span>`
  const head = `<div class="cal-month-head">${prev}<span class="cal-month-name">${MONTH_NAMES[m]} ${y}</span>${next}</div>`
  return `<div class="cal-month" data-m="${idx}">${head}<div class="cal-grid">${dows}${cells}</div></div>`
}

// One month visible at a time. The radio inputs sit as siblings before the month
// panels; CSS shows the panel matching the checked input.
export function renderCalendar(events, units = []) {
  const data = collect(events, units)
  const radios = MONTHS.map(
    (_, i) =>
      `<input class="cal-radio" type="radio" name="cal-page" id="cal-m${i}"${i === 0 ? " checked" : ""}>`,
  ).join("")
  const months = MONTHS.map(([y, m], i) => renderMonth(y, m, data, i, MONTHS.length)).join("")
  return `<div class="cal cal-paged">${radios}${months}</div>`
}

// School holidays, the exam window and the major term anchors are context on every
// calendar; assessments belong to their course.
// School-wide items that belong on every calendar, whoever's it is.
//
// `school-event` joined this set on 2026-08-13 (Doğan: "add the ⚠ school events
// too"). Note that the ⚠ in the vault's own event notes does NOT survive into the
// agenda table this parses: make-up days carry "⚠️ School" in the scope column, but
// Foreign Culture Day is plain "School", so a rule keyed on the marker would have
// missed the clearest example of the thing being asked for. The whole class is
// admitted instead — 17 rows across Semester 1: assemblies, introduction days,
// parent evenings, make-up days, the field trip, three Foreign Culture Days,
// Seniors' Days, application deadlines and the end-of-semester activity. Every one
// of them changes a student's day, which is the test.
//
// They render as quiet text via .cal-ev--school, the same weight as a holiday name
// or a term anchor, so admitting them does not shout over the graded chips.
const isContext = (ev) =>
  ev.kind === "holiday" ||
  ev.kind === "exam" ||
  ev.kind === "anchor" ||
  ev.kind === "school-event"

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

// The hub legend lists every course, each key a link to that course's own
// calendar; a per-course legend explains the levels of visual weight instead
// (solid attainment → outlined task → tiny LB → unit bar).
function legendHtml(mode) {
  if (!mode) {
    const courseChips = Object.keys(COURSE_KEYS)
      .map((k) =>
        tag(`cal-key cal-ev--${k}`, COURSE_KEYS[k], {
          href: `${COURSES[k].dir}/course-calendar`,
          title: `${COURSES[k].name} calendar`,
        }),
      )
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
    // Agenda events know only their course, so their chips point at the course's
    // assessment register (the page that carries the dated detail); school context
    // points back at the hub calendar it came from. Register- and lesson-derived
    // events already carry the page they were parsed out of.
    const fallback = detail?.register ?? COURSES[mode].overview
    const context = events.filter(isContext).map((ev) => ({ ...ev, href: "calendar" }))
    const own = events
      .filter((ev) => ev.course === mode && !isContext(ev))
      .map((ev) => ({ ...ev, href: fallback }))
    const merged = detail
      ? mergeCourseEvents(own, detail.events).map((ev) => ({ ...ev, course: mode }))
      : own
    grid = renderCalendar([...context, ...merged], detail?.units ?? [])
  } else {
    // On the hub, a course chip drills down into that course's own calendar; a
    // school chip has nowhere to go but the agenda table further down this page,
    // which is the only place its full wording lives. The anchor is Quartz's slug
    // for the vault's "📋 Agenda (chronological)" heading — if that heading is
    // reworded the link still lands on the page, just without the scroll.
    const combined = eventsCombined(events).map((ev) => ({
      ...ev,
      href: COURSES[ev.course]
        ? `${COURSES[ev.course].dir}/course-calendar`
        : "calendar#-agenda-chronological",
    }))
    grid = renderCalendar(combined)
  }
  const wrap = mode ? ` cal--${mode}` : ""
  return `<div class="calwrap${wrap}">${legendHtml(mode)}\n${grid}</div>`
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dayName = (iso) => WEEKDAY[new Date(iso + "T00:00:00Z").getUTCDay()]

// ── The next two weeks ───────────────────────────────────────────────────────
// A compact companion to the month grid, for the question students actually
// arrive with: what is due soon. A list, not a grid, because the audience is on
// a phone and seven columns of mostly-empty cells is the wrong shape for one.
//
// **Week-aligned on purpose.** It renders the whole of the current Monday-to-Sunday
// week plus the next one, and marks no "today". That keeps the output identical for
// seven days at a stretch, so this block does not make content/ change every
// morning and turn the cowardly daily publisher into a daily committer. It also
// stays correct all week rather than only on the day it was built. The cost is that
// a day already past still shows; its date is right there, and the passed item is
// useful context anyway.
//
// Each event lands on ONE day, the one a student cares about: the due date for a
// task that spans "set → due", the start otherwise. Spans like a holiday week
// therefore appear once, with their own label carrying the range.
const HUE = {
  "a-level": "--c-a-level",
  media: "--c-media",
  "art-app": "--c-art-app",
  pal: "--c-pal",
  oxbridge: "--c-oxbridge",
}

const hueVar = (ev) =>
  HUE[ev.course] ?? (ev.kind === "holiday" ? "--c-holiday" : ev.kind === "exam" ? "--c-exam" : null)

// Monday of the week containing `iso`, as an ISO date.
function mondayOf(iso) {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00Z")
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
}

// The chip's words. Three sources, in order of how student-facing they are:
//
// 1. `ev.desc`, when a register or lesson plan supplied it. Already written for
//    students, so it is used as-is.
// 2. The label's leading **bold** segment. The agenda's convention is
//    "**Headline** — prose clarifying it for whoever reads the table", and that
//    prose is written for a colleague: the Oxbridge deadline row explains it is
//    "a G12 application anchor, *not* a milestone in the Discussion Group", which
//    is exactly the sort of aside a student should never be shown.
// 3. The whole label, cleaned, when there is no bold head — some rows are simply
//    "Parent meeting — G11 (eve)", where the tail after the dash is the content
//    and cutting at the dash would throw away the half that matters.
function fortnightLabel(ev, withCourse) {
  const code = ev.code ?? ev.label?.match(/\b(A[1-4]|EoT|CS\d+|HW\d+|LB\d+)\b/)?.[1]
  const strip = (t) =>
    t
      .replace(/\[\[[^\]|]*\\?\|([^\]]*)\]\]/g, "$1") // [[path|alias]] keeps the alias
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\*+/g, "")
      .trim()

  // Descriptions and headlines both tend to elaborate after a dash or a colon
  // ("Unit 2 comparative essay — one claim about Titian vs Manet"). A chip is a
  // label, not the brief: cut at the separator so it reads whole, rather than
  // truncating mid-clause into an ellipsis. The full text is one click away on the
  // register. This also keeps em dashes out of generated prose, per house style.
  // Cut at a dash, colon or opening parenthesis, since what follows is elaboration
  // and often planning language: the field-trip row ends "(date ambiguous)" and a
  // make-up day "(timetable TBC)", neither of which is a student's business.
  // chipHtml cuts on the same characters for the month grid, so both views agree.
  // The cost is a genuinely useful "(eve)" on the parent-meeting rows; the grid has
  // always dropped it too, and the calendar page spells those out in full. Fall
  // back to the first comma only when the result would still be ellipsized, which
  // is what turns "Technical lexicon quiz, 30 items in 20 min, across all four"
  // into a label instead of a sentence with its end bitten off.
  const room = code ? 52 : 62
  const head = (t) => {
    let x = t.split(/\s+—\s+|:\s+|\s*\(/)[0].trim()
    if (x.length > room) {
      const c = x.split(/,\s+/)[0].trim()
      if (c.length >= 12) x = c
    }
    return x
  }

  let text
  if (ev.desc) text = head(strip(ev.desc))
  else {
    const raw = ev.label ?? ""
    const bold = raw.match(/^\s*\*\*(.+?)\*\*/)?.[1]
    text = head(strip(bold ?? raw))
  }
  // The label often repeats the code it was mined from; do not print it twice.
  if (code) text = text.replace(new RegExp(`^${code}\\b[\\s:·-]*`), "").trim()

  const prefix = withCourse && COURSE_KEYS[ev.course] ? `${COURSE_KEYS[ev.course]} ` : ""
  return (
    prefix +
    (code ? `<b>${code}</b>` : "") +
    (code && text ? " " : "") +
    (text ? trunc(text, room) : "")
  ).trim()
}

/**
 * `mode` is null for the combined view or a COURSES key for one course's own.
 * `depth` is how far the host page sits below content/ root, so hrefs resolve
 * (0 for index.md, 2 for classes/<course>/course-calendar.md).
 */
export function fortnight(events, mode, todayISO, depth = 0, ownHref = null) {
  const up = "../".repeat(depth)
  const scoped = mode ? eventsForCourse(events, mode) : eventsCombined(events)

  // Lessons are excluded. This view answers "what do I have to do", and a lesson
  // title is neither a deadline nor a disruption; the month grid already labels
  // each lesson where it begins, and mixing the two buries the items that carry a
  // date the student has to act on. Drop the filter to include them.
  const dated = scoped.filter((ev) => ev.kind !== "lesson")

  // One operative day per event.
  const byDay = new Map()
  for (const ev of dated) {
    const day = ev.kind === "cs" || ev.kind === "lb" ? (ev.end ?? ev.start) : ev.start
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(ev)
  }
  for (const list of byDay.values()) list.sort((a, b) => (WEIGHT[a.kind] ?? 1) - (WEIGHT[b.kind] ?? 1))

  const start = mondayOf(todayISO)
  const weeks = []
  for (let w = 0; w < 2; w++) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start + "T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + w * 7 + i)
      const iso = d.toISOString().slice(0, 10)
      const evs = byDay.get(iso) ?? []
      if (evs.length) days.push({ iso, evs })
    }
    const first = new Date(start + "T00:00:00Z")
    first.setUTCDate(first.getUTCDate() + w * 7)
    const last = new Date(first)
    last.setUTCDate(last.getUTCDate() + 6)
    weeks.push({
      title: w === 0 ? "This week" : "Next week",
      range: `${shortDate(first.toISOString().slice(0, 10))} to ${shortDate(last.toISOString().slice(0, 10))}`,
      days,
    })
  }

  const weekHtml = (wk) => {
    const body = wk.days.length
      ? `<ul class="fortnight__days">${wk.days
          .map(
            (d) =>
              `<li class="fortnight__day"><span class="fortnight__date">${dayName(d.iso)} ${new Date(d.iso + "T00:00:00Z").getUTCDate()}</span>` +
              `<span class="fortnight__evs">${d.evs
                .map((ev) => {
                  const hue = hueVar(ev)
                  const style = hue ? ` style="--c: var(${hue})"` : ""
                  // On a course's own page, a chip linking to that page is a
                  // no-op: send it to the register the item was parsed from, the
                  // same target the list further down the page uses. On the
                  // combined view, send it to the course's calendar instead.
                  const href = !(ev.course && COURSES[ev.course])
                    ? `${up}calendar`
                    : mode && ownHref
                      ? `${up}${ownHref}`
                      : `${up}${COURSES[ev.course].dir}/course-calendar`
                  return `<a class="fortnight__ev" href="${href}"${style}>${fortnightLabel(ev, !mode)}</a>`
                })
                .join("")}</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="fortnight__none">Nothing scheduled.</p>`
    return `<section class="fortnight__week"><p class="fortnight__label">${wk.title} <span>${wk.range}</span></p>${body}</section>`
  }

  // Both weeks empty is normal in the holidays, and "Nothing scheduled" twice tells
  // a student nothing. Name the next dated thing beyond the window instead.
  let note = ""
  if (!weeks.some((w) => w.days.length)) {
    const endOfWindow = new Date(start + "T00:00:00Z")
    endOfWindow.setUTCDate(endOfWindow.getUTCDate() + 13)
    const endISO = endOfWindow.toISOString().slice(0, 10)
    const next = dated
      .filter((ev) => (ev.start ?? "") > endISO)
      .sort((a, b) => a.start.localeCompare(b.start))[0]
    if (next)
      note =
        `<p class="fortnight__ahead">Next up: <strong>${fortnightLabel(next, !mode)}</strong>` +
        ` on ${dayName(next.start)} ${shortDate(next.start)}.</p>`
  }

  return `<div class="fortnight">${weeks.map(weekHtml).join("")}</div>${note}`
}

// A generated per-course calendar page (site-only — links use Quartz wikilinks).
export function coursePage(key, events, detail, todayISO) {
  const c = COURSES[key]
  const own = events.filter((ev) => ev.course === key && !isContext(ev))
  const all = detail ? mergeCourseEvents(own, detail.events) : own

  // The fortnight's own set. Detail events come from the registers and lesson
  // plans, which do not carry a `course` key, so they are stamped with this one:
  // without it fortnight()'s course filter silently dropped every graded item and
  // a Media student's page showed a G12 school anchor but not their own A1.
  const forFortnight = [
    ...all.map((ev) => ({ ...ev, course: ev.course ?? key })),
    ...events.filter(isContext),
  ]

  // The code links to the page the item was parsed from — the register for graded
  // items, so the list below the grid clicks through the same way the chips do.
  const href = detail?.register ?? c.overview
  const line = (e) => {
    const code = e.code ?? e.label?.match(/\b(A[1-4]|EoT|CS\d+|HW\d+)\b/)?.[1]
    const desc = e.desc ?? e.label?.replace(/\*\*/g, "")
    const due = e.kind === "cs" && e.end !== e.start ? `${e.end} (due)` : e.start
    const link = code ? `[[${e.href ?? href}|**${code}**]]` : ""
    return `- **${dayName(due.slice(0, 10))} ${due}** — ${link} ${desc ?? ""}`.trimEnd()
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

${todayISO ? `## The next two weeks\n\n${fortnight(forFortnight, key, todayISO, 2, href)}\n\n## Month view\n` : ""}
Semester 1, September 2026 – January 2027. Solid chips are the graded attainments; outlined chips are class tasks and homework; **LB** marks participation postings. The bar above each week is the unit running through those dates, with each lesson labelled where it begins. Holidays and the exam window are shaded. Everything on the grid is a link — chips open the assessment register, lesson labels the lesson plan, unit bars the unit plan.

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
