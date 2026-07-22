// Build the "course map" section injected into each course overview page: a
// structured grid of the course's subpages (plans, units, lessons, assessments,
// calendar, resources) replacing the old inline "Start here" sentence links.
//
// Everything is derived from the published file list + frontmatter titles, so the
// map can't drift from what actually exists on the site.

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
    return { group: "assessments", label: m ? `S${m[1]} assessments` : "Assessments", sort: m ? +m[1] : 0 }
  }
  if (/lesson-(\d+)/.test(base)) {
    const n = +base.match(/lesson-(\d+)/)[1]
    const t = title.match(/Lesson \d+[:.]?\s*(.*)/i)?.[1] ?? ""
    return { group: "lessons", label: `L${String(n).padStart(2, "0")}`, tip: t, sort: n }
  }
  if (/unit-(\d+)/.test(base)) {
    const n = +base.match(/unit-(\d+)/)[1]
    const sem = +(base.match(/\bs(\d)-unit/)?.[1] ?? 1)
    const t = title.match(/Unit \d+[:.]?\s*(.*)/i)?.[1] ?? title
    return { group: "units", label: `U${n} ${t}`, sort: sem * 100 + n, sem }
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
  if (base.includes("resource-library")) return { group: "more", label: "Resource library", sort: 1 }
  if (base.includes("handbook")) return { group: "more", label: "Department handbook", sort: 2 }
  if (rel.includes("lesson-plans/")) {
    return { group: "more", label: title.replace(/^[A-Z0-9]+ S\d /, ""), sort: 3 }
  }
  return null
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// items: [{ rel, title }] for one course, rels relative to the course dir; `dir` is
// the course directory from the content root. Hrefs are emitted as full
// root-relative slugs — Quartz's link transformer resolves raw hrefs against the
// content root (not the current page's directory) and relativizes them itself.
export function courseMapHtml(items, dir) {
  const groups = { plans: [], units: [], lessons: [], assessments: [], calendar: [], more: [] }
  for (const it of items) {
    const c = classify(it.rel, it.title)
    if (c) groups[c.group].push({ ...c, href: `${dir}/${it.rel.replace(/\.md$/, "")}` })
  }
  for (const g of Object.values(groups)) g.sort((a, b) => a.sort - b.sort)
  if (!Object.values(groups).some((g) => g.length)) return ""

  const link = (it) =>
    `<a href="${it.href}"${it.tip ? ` title="${esc(it.tip)}"` : ""}>${esc(it.label)}</a>`

  // Units grouped by semester when a course spans more than one.
  const sems = [...new Set(groups.units.map((u) => u.sem))]
  const unitsHtml =
    sems.length > 1
      ? sems
          .map(
            (s) =>
              `<div class="cmap-sem">S${s}</div><ul>${groups.units
                .filter((u) => u.sem === s)
                .map((u) => `<li>${link(u)}</li>`)
                .join("")}</ul>`,
          )
          .join("")
      : `<ul>${groups.units.map((u) => `<li>${link(u)}</li>`).join("")}</ul>`

  const col = (title, inner) =>
    inner ? `<div class="cmap-col"><h3 class="cmap-h">${title}</h3>${inner}</div>` : ""

  const planItems = [...groups.calendar, ...groups.plans, ...groups.assessments, ...groups.more]
  const plansHtml = planItems.length
    ? `<ul>${planItems.map((p) => `<li>${link(p)}</li>`).join("")}</ul>`
    : ""
  const lessonsHtml = groups.lessons.length
    ? `<div class="cmap-chips">${groups.lessons.map(link).join("")}</div>`
    : ""

  return `<nav class="cmap">${col("Plan", plansHtml)}${col("Units", groups.units.length ? unitsHtml : "")}${col("Lessons", lessonsHtml)}</nav>\n\n`
}
