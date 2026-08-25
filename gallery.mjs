#!/usr/bin/env node
// Build the single "Image library" gallery page from the downsampled plates.
//
// Reads credits.json (slug → caption, written by images.mjs) and emits a Quartz
// content page: one responsive grid of every plate the site hosts. Most plates
// are public domain; since 2026-08-09 the collection also carries in-copyright
// teaching material (film and TV frames, advertising) — the site is behind a
// password gate and serves one teacher's classes, so teaching use is cleared.
//
// library-taxonomy.json (built by taxonomy.mjs) classifies each plate by era,
// medium and movement; library-usage.json (written by sync.mjs from its placement
// tables) records the courses whose pages carry it. Those become the four filter
// rows above the wall and a class list on each figure. The filtering is CSS only —
// radio inputs and labels, the same no-JS pattern the calendar pager uses — so it
// survives Quartz's SPA navigation and works with the page's scripts blocked.
//
// Imported by sync.mjs (which writes content/library.md each run) and runnable
// standalone for a quick preview: `node gallery.mjs`.

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { ERAS, MEDIUMS, MOVEMENTS, COURSES } from "./taxonomy.mjs"

// The filter rows, in the order they appear. Each entry is the radio group's
// name, the row's label, and its vocabulary as [key, label] pairs. The first
// three axes hold one value per plate (frozen in library-taxonomy.json); the
// course axis is a set, because a plate can sit on pages of several courses.
const AXES = [
  ["era", "Era", ERAS.map(([k, label]) => [k, label])],
  ["med", "Medium", MEDIUMS],
  ["mov", "Movement", MOVEMENTS],
  ["cls", "Course", COURSES],
]

function figure(slug, credit, dir, cls) {
  const caption = credit.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  const alt = credit.replace(/\*/g, "").replace(/"/g, "&quot;")
  return (
    `  <figure class="${cls}">\n` +
    `    <img src="static/img/${dir}${slug}.jpg" alt="${alt}" loading="lazy" />\n` +
    `    <figcaption>${caption}</figcaption>\n` +
    `  </figure>`
  )
}

// One radio per value plus an "All" that constrains nothing. They sit as siblings
// ahead of the wall so `:checked ~` can reach it, and ahead of each other in axis
// order so the empty-state rules below can chain across all three groups.
function radios() {
  return AXES.flatMap(([axis, , values]) => [
    `<input class="gal-r" type="radio" name="gal-${axis}" id="gal-${axis}-all" checked>`,
    ...values.map(
      ([k]) => `<input class="gal-r" type="radio" name="gal-${axis}" id="gal-${axis}-${k}">`,
    ),
  ]).join("")
}

// A value with no plates would be a chip that always empties the wall, so it is
// left out entirely. Counts are for the axis on its own — exact in the default
// view, which is where you read them.
function filters(counts, total) {
  const rows = AXES.map(([axis, name, values]) => {
    const chips = [
      `<label class="gal-chip gal-chip--${axis}-all" for="gal-${axis}-all">All <i>${total}</i></label>`,
      ...values
        .filter(([k]) => counts[axis][k])
        .map(
          ([k, label]) =>
            `<label class="gal-chip gal-chip--${axis}-${k}" for="gal-${axis}-${k}">${label} <i>${counts[axis][k]}</i></label>`,
        ),
    ].join("")
    return `  <div class="gal-row"><span class="gal-row-name">${name}</span><span class="gal-chips">${chips}</span></div>`
  }).join("\n")
  return `<div class="gal-filters">\n${rows}\n</div>`
}

// The filtering rules, generated rather than written into custom.scss because the
// vocabulary lives in taxonomy.mjs — one place to add a category.
//
// Three families. Each value hides the plates it does not name, and because the
// three groups hide independently, a selection in each narrows the wall to the
// intersection. Each value also lights its own chip — CSS cannot put a class on the
// chosen one, so the selected colours have to be declared here rather than in
// custom.scss with the rest of the chip. Then, since narrowing can reach a
// combination nothing occupies, the standing "nothing here" line is hidden by
// whichever combinations DO exist — one selector per combination, with :is()
// folding in the "All" of each axis, so 30 rules cover all 672 states the three
// groups can be in.
const CHIP_ON = "background:var(--secondary);border-color:var(--secondary);color:var(--light)"

function filterCss(present, combos) {
  const rules = []
  for (const [axis, , values] of AXES) {
    rules.push(`#gal-${axis}-all:checked~.gal-filters .gal-chip--${axis}-all{${CHIP_ON}}`)
    for (const [k] of values.filter(([k]) => present[axis].has(k))) {
      rules.push(`#gal-${axis}-${k}:checked~.gal-body .plate:not(.p-${axis}-${k}){display:none}`)
      rules.push(`#gal-${axis}-${k}:checked~.gal-filters .gal-chip--${axis}-${k}{${CHIP_ON}}`)
    }
  }

  const nonEmpty = [...combos]
    .map((c) => {
      // The fourth part is the plate's course set, comma-joined: the plate is
      // visible under "All" or under any one of its own courses.
      const [era, med, mov, cls] = c.split(" ")
      const any = (axis, ks) =>
        `:is(${["all", ...ks].map((k) => `#gal-${axis}-${k}`).join(",")}):checked`
      return `${any("era", [era])}~${any("med", [med])}~${any("mov", [mov])}~${any("cls", cls.split(","))}~.gal-body .gal-empty`
    })
    .join(",")
  // Guarded: an empty selector list would be a malformed rule rather than no rule.
  if (nonEmpty) rules.push(`${nonEmpty}{display:none}`)

  return `<style>\n${rules.join("\n")}\n</style>`
}

// `credits` are the hand-curated hero plates (quartz/static/img/); `libCredits`
// are the bulk public-domain batch from library-images.mjs (…/img/lib/).
// `taxonomy` maps slug → "era medium movement"; without it the page is the plain
// ungrouped wall it was before the filters existed. `usage` maps slug → [course]
// from sync.mjs's placement tables; a plate it does not name is collection stock,
// which gets the standing "library" value rather than a hole in the axis.
export function libraryMarkdown(credits, libCredits = {}, taxonomy = {}, usage = {}) {
  const plates = [
    ...Object.entries(credits).map(([slug, credit]) => [slug, credit, ""]),
    ...Object.entries(libCredits).map(([slug, credit]) => [slug, credit, "lib/"]),
  ]
  const count = plates.length
  const classified = plates.filter(([slug]) => taxonomy[slug]).length
  const coursesOf = (slug) => (usage[slug]?.length ? [...usage[slug]].sort() : ["library"])

  const head =
    `---\n` +
    `title: Image library\n` +
    `---\n\n` +
    `# Image library\n\n` +
    `Every image used across these courses, gathered in one place — ${count} works ` +
    `from the shared teaching collection, each captioned with artist, title and date. ` +
    `Most are public domain; the film frames, covers and other in-copyright material ` +
    `are here for teaching, behind the site's password gate.\n\n`

  // Every plate has to be classified for the filters to be honest — a stale
  // taxonomy would quietly drop plates out of every view but "All".
  if (classified < count) {
    const figures = plates.map(([s, c, dir]) => figure(s, c, dir, "plate")).join("\n")
    return head + `<div class="gallery">\n${figures}\n</div>\n`
  }

  const counts = { era: {}, med: {}, mov: {}, cls: {} }
  const present = { era: new Set(), med: new Set(), mov: new Set(), cls: new Set() }
  const combos = new Set()
  const bump = (axis, v) => {
    counts[axis][v] = (counts[axis][v] || 0) + 1
    present[axis].add(v)
  }
  for (const [slug] of plates) {
    const t = taxonomy[slug]
    const cls = coursesOf(slug)
    combos.add(`${t} ${cls.join(",")}`)
    t.split(" ").forEach((v, i) => bump(AXES[i][0], v))
    for (const c of cls) bump("cls", c)
  }

  const figures = plates
    .map(([slug, credit, dir]) => {
      const [era, med, mov] = taxonomy[slug].split(" ")
      const cls = coursesOf(slug)
        .map((c) => ` p-cls-${c}`)
        .join("")
      return figure(slug, credit, dir, `plate p-era-${era} p-med-${med} p-mov-${mov}${cls}`)
    })
    .join("\n")

  return (
    head +
    `Filter the wall by when a work was made, what it was made with, the movement ` +
    `it belongs to, or the course whose pages use it. Choices combine, and every ` +
    `plate keeps its caption.\n\n` +
    `<div class="gal">${radios()}\n${filters(counts, count)}\n` +
    `<div class="gal-body">\n<div class="gallery">\n${figures}\n</div>\n` +
    `<p class="gal-empty">No plates sit in all of those at once — widen one of them.</p>\n` +
    `</div>\n</div>\n\n` +
    // Last in the document on purpose: Quartz builds the page description out of
    // the text it finds, and a stylesheet near the top lands in the meta tags.
    `${filterCss(present, combos)}\n`
  )
}

// Standalone run: write content/library.md for a quick local preview.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async (f) => {
    try {
      return JSON.parse(await readFile(join(import.meta.dirname, f), "utf8"))
    } catch {
      return {}
    }
  }
  const credits = await read("credits.json")
  const libCredits = await read("library-credits.json")
  const taxonomy = await read("library-taxonomy.json")
  const usage = await read("library-usage.json")
  await writeFile(
    join(import.meta.dirname, "content/library.md"),
    libraryMarkdown(credits, libCredits, taxonomy, usage),
  )
  console.log(
    `wrote content/library.md (${Object.keys(credits).length} heroes + ${Object.keys(libCredits).length} library)`,
  )
}
