// Build the "course map" section injected into each course overview page.
//
// Semester-first: a utility strip of course-wide pages (calendar, course map,
// handbook, resource library), then one card per semester. A semester with
// published lessons renders in full — its units in pipeline order, each with
// the lessons that belong to it nested alongside — and the latest such
// semester is marked as the current one. Semesters without lessons render as
// compact cards (plan, assessments, unit chips).
//
// Everything is derived from the published file list + frontmatter, so the map
// can't drift from what actually exists on the site. The one hand-maintained
// piece is SEMESTER_INFO below: season and one-line subtitle per semester,
// which aren't derivable from filenames.

// Season + subtitle per course (keyed by course directory basename). A
// semester absent from both this table and the published files never renders;
// a published semester absent here just gets a plain "Semester N" header.
const SEMESTER_INFO = {
  "a-level-art-design": {
    1: ["autumn 2026", "C1 Portfolio"],
    2: ["spring 2027", "C3 Personal Investigation, part 1"],
    3: ["autumn 2027", "C3 finished & submitted"],
    4: ["spring 2028", "C2 test & final submission"],
  },
  "media-studies": {
    1: ["autumn 2026", "Media language & C1 production"],
    2: ["spring 2027", "C1 submission · Paper 2"],
    3: ["autumn 2027", "C3 launch & production"],
    4: ["spring 2028", "C3 submission · Paper 4"],
  },
  "art-appreciation": {
    1: ["autumn 2026", "Origins to modernity, five units"],
    2: ["spring 2027", "Second semester, in outline"],
  },
  "pre-a-level-art-design": {
    1: ["autumn 2026", "Draw · photograph · collage · design"],
  },
}

// Shorten a frontmatter title for its slot in the map.
//   "9607 S1 Unit 2: Media Language"        → { n: 2, text: "Media Language" }
//   "Art Appreciation S1 Lesson 04: …"      → L04
//   "9479 Semester 1 Plan"                  → Semester 1 plan
export function classify(rel, title) {
  const base = rel.split("/").pop().replace(/\.md$/, "")
  // Curated folder-listing pages: navigation chrome, not course content.
  if (base === "index") return null
  // "Course calendar", to keep it distinct from the site-wide Calendar link.
  if (base === "course-calendar") return { group: "calendar", label: "Course calendar", sort: 0 }
  if (rel.includes("assessments/")) {
    const m = title.match(/\bS(\d)\b/i)
    return {
      group: "assessments",
      label: m ? `S${m[1]} assessments` : "Assessments",
      sort: m ? +m[1] : 0,
    }
  }
  if (/lesson-(\d+)/.test(base)) {
    const n = +base.match(/lesson-(\d+)/)[1]
    const sem = +(base.match(/\bs(\d+)-lesson/)?.[1] ?? 1)
    const t = title.match(/Lesson \d+[:.]?\s*(.*)/i)?.[1] ?? ""
    return { group: "lessons", label: `L${String(n).padStart(2, "0")}`, tip: t, sort: n, sem }
  }
  if (/unit-(\d+)/.test(base)) {
    const n = +base.match(/unit-(\d+)/)[1]
    const sem = +(base.match(/\bs(\d)-unit/)?.[1] ?? 1)
    const t = title.match(/Unit \d+[:.]?\s*(.*)/i)?.[1] ?? title
    return { group: "units", label: `U${n} ${t}`, sort: n, sem, n, name: t, base }
  }
  if (rel.includes("unit-plans/")) {
    // course maps, semester plans, outlines — titles may carry a "Course ·" prefix
    const label = title
      .replace(/^.*?(Course Map|Semester \d (?:Plan|Outline))$/i, "$1")
      .replace(/^Course Map$/i, "Course map")
      .replace(/Plan$/, "plan")
      .replace(/Outline$/, "outline")
    const sem = +(title.match(/Semester (\d)/i)?.[1] ?? 0)
    return { group: "plans", label, sort: sem }
  }
  if (base.includes("resource-library"))
    return { group: "more", label: "Resource library", sort: 1 }
  if (base.includes("handbook")) return { group: "more", label: "Department handbook", sort: 2 }
  if (rel.includes("lesson-plans/")) {
    return { group: "more", label: title.replace(/^[A-Z0-9]+ S\d /, ""), sort: 3 }
  }
  return null
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// items: [{ rel, title, unit? }] for one course, rels relative to the course
// dir; `unit` is the base filename of the unit a lesson belongs to, parsed from
// the lesson's frontmatter by sync.mjs. `dir` is the course directory from the
// content root. Hrefs are emitted as full root-relative slugs — Quartz's link
// transformer resolves raw hrefs against the content root (not the current
// page's directory) and relativizes them itself.
export function courseMapHtml(items, dir) {
  const classified = []
  for (const it of items) {
    const c = classify(it.rel, it.title)
    if (c) classified.push({ ...c, href: `${dir}/${it.rel.replace(/\.md$/, "")}`, unit: it.unit })
  }
  if (!classified.length) return ""

  const link = (it, label = it.label) =>
    `<a href="${it.href}"${it.tip ? ` title="${esc(it.tip)}"` : ""}>${esc(label)}</a>`

  // Course-wide reference pages: one line above the semester cards.
  const utility = [
    ...classified.filter((c) => c.group === "calendar"),
    ...classified.filter((c) => c.group === "plans" && !c.sort),
    ...classified.filter((c) => c.group === "more").sort((a, b) => a.sort - b.sort),
  ]

  // Everything else groups by semester.
  const sems = new Map()
  const sem = (n) => {
    if (!sems.has(n)) sems.set(n, { plan: null, register: null, units: [], lessons: [] })
    return sems.get(n)
  }
  for (const c of classified) {
    if (c.group === "plans" && c.sort) sem(c.sort).plan = c
    else if (c.group === "assessments") sem(c.sort || 1).register = c
    else if (c.group === "units") sem(c.sem).units.push(c)
    else if (c.group === "lessons") sem(c.sem).lessons.push(c)
  }

  const info = SEMESTER_INFO[dir.split("/").pop()] ?? {}
  const semNums = [...sems.keys()].sort((a, b) => a - b)
  // The semester being taught: the latest one with published lessons.
  const current = Math.max(0, ...semNums.filter((n) => sem(n).lessons.length))

  const planLabel = (p, full) =>
    /outline/i.test(p.label)
      ? full
        ? "Semester outline"
        : "Outline"
      : full
        ? "Semester plan"
        : "Plan"

  const cards = semNums.map((n) => {
    const s = sems.get(n)
    s.units.sort((a, b) => a.sort - b.sort)
    s.lessons.sort((a, b) => a.sort - b.sort)
    const [season, note] = info[n] ?? []
    const title = esc(`Semester ${n}${season ? ` · ${season}` : ""}`)
    const full = s.lessons.length > 0

    if (full) {
      const byUnit = new Map(s.units.map((u) => [u.base, []]))
      const orphans = []
      for (const l of s.lessons) (byUnit.get(l.unit) ?? orphans).push(l)
      const rows = s.units
        .map((u) => {
          const chips = byUnit.get(u.base)
          return `<li>${link(u)}${chips.length ? `<span class="cmap-ls">${chips.map((l) => link(l)).join("")}</span>` : ""}</li>`
        })
        .join("")
      // Lessons whose unit isn't published (or declared): keep them reachable.
      const orphanRow = orphans.length
        ? `<li><span class="cmap-ls">${orphans.map((l) => link(l)).join("")}</span></li>`
        : ""
      const head = `<span class="cmap-card-title">${title}</span>${note ? `<span class="cmap-badge">${esc(note)}</span>` : ""}`
      const links = [
        s.plan && link(s.plan, planLabel(s.plan, true)),
        s.register && link(s.register, "Assessment register"),
      ]
        .filter(Boolean)
        .join(" · ")
      return `<section class="cmap-card${n === current ? " cmap-card--now" : ""}"><header class="cmap-card-head">${head}</header>${links ? `<p class="cmap-links">${links}</p>` : ""}<ul class="cmap-units">${rows}${orphanRow}</ul></section>`
    }

    const links = [
      s.plan && link(s.plan, planLabel(s.plan, false)),
      s.register && link(s.register, "Assessments"),
    ]
      .filter(Boolean)
      .join(" · ")
    const minis = s.units
      .map((u) => `<a href="${u.href}" title="${esc(u.name)}">U${u.n}</a>`)
      .join("")
    return `<section class="cmap-card"><header class="cmap-card-head"><span class="cmap-card-title">${title}</span></header>${note ? `<p class="cmap-note">${esc(note)}</p>` : ""}${links ? `<p class="cmap-links">${links}</p>` : ""}${minis ? `<p class="cmap-minis">${minis}</p>` : ""}</section>`
  })

  const fulls = cards.filter((_, i) => sems.get(semNums[i]).lessons.length > 0)
  const compacts = cards.filter((_, i) => sems.get(semNums[i]).lessons.length === 0)
  const utilRow = utility.length
    ? `<p class="cmap-util">${utility.map((u) => link(u)).join("")}</p>`
    : ""
  const grid = compacts.length ? `<div class="cmap-grid">${compacts.join("")}</div>` : ""
  return `<nav class="cmap">${utilRow}${fulls.join("")}${grid}</nav>\n\n`
}
