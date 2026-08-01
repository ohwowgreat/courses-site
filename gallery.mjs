#!/usr/bin/env node
// Build the single "Image library" gallery page from the downsampled plates.
//
// Reads credits.json (slug → caption, written by images.mjs) and emits a Quartz
// content page: one responsive grid of every plate the site hosts. Only works
// already downsampled into quartz/static/img/ appear here — the same pre-1930
// public-domain set images.mjs is deliberately restricted to. In-copyright works
// are never added to this page; lessons cite those by name instead.
//
// library-taxonomy.json (built by taxonomy.mjs) classifies each plate by era,
// medium and movement; those become the three filter rows above the wall and a
// class triple on each figure. The filtering is CSS only — radio inputs and
// labels, the same no-JS pattern the calendar pager uses — so it survives Quartz's
// SPA navigation and works with the page's scripts blocked.
//
// Imported by sync.mjs (which writes content/library.md each run) and runnable
// standalone for a quick preview: `node gallery.mjs`.

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { ERAS, MEDIUMS, MOVEMENTS } from "./taxonomy.mjs"

// The three filter rows, in the order they appear. Each entry is the radio group's
// name, the row's label, and its vocabulary as [key, label] pairs.
const AXES = [
  ["era", "Era", ERAS.map(([k, label]) => [k, label])],
  ["med", "Medium", MEDIUMS],
  ["mov", "Movement", MOVEMENTS],
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
      const [era, med, mov] = c.split(" ")
      const any = (axis, k) => `:is(#gal-${axis}-all,#gal-${axis}-${k}):checked`
      return `${any("era", era)}~${any("med", med)}~${any("mov", mov)}~.gal-body .gal-empty`
    })
    .join(",")
  // Guarded: an empty selector list would be a malformed rule rather than no rule.
  if (nonEmpty) rules.push(`${nonEmpty}{display:none}`)

  return `<style>\n${rules.join("\n")}\n</style>`
}

// `credits` are the hand-curated hero plates (quartz/static/img/); `libCredits`
// are the bulk public-domain batch from library-images.mjs (…/img/lib/).
// `taxonomy` maps slug → "era medium movement"; without it the page is the plain
// ungrouped wall it was before the filters existed.
export function libraryMarkdown(credits, libCredits = {}, taxonomy = {}) {
  const plates = [
    ...Object.entries(credits).map(([slug, credit]) => [slug, credit, ""]),
    ...Object.entries(libCredits).map(([slug, credit]) => [slug, credit, "lib/"]),
  ]
  const count = plates.length
  const classified = plates.filter(([slug]) => taxonomy[slug]).length

  const head =
    `---\n` +
    `title: Image library\n` +
    `---\n\n` +
    `# Image library\n\n` +
    `Every image used across these courses, gathered in one place — ${count} public-domain ` +
    `works from the shared teaching collection, each captioned with artist, title and date. ` +
    `In-copyright works studied in class are named in the lessons rather than shown here.\n\n`

  // Every plate has to be classified for the filters to be honest — a stale
  // taxonomy would quietly drop plates out of every view but "All".
  if (classified < count) {
    const figures = plates.map(([s, c, dir]) => figure(s, c, dir, "plate")).join("\n")
    return head + `<div class="gallery">\n${figures}\n</div>\n`
  }

  const counts = { era: {}, med: {}, mov: {} }
  const present = { era: new Set(), med: new Set(), mov: new Set() }
  const combos = new Set()
  for (const [slug] of plates) {
    const t = taxonomy[slug]
    combos.add(t)
    t.split(" ").forEach((v, i) => {
      const axis = AXES[i][0]
      counts[axis][v] = (counts[axis][v] || 0) + 1
      present[axis].add(v)
    })
  }

  const figures = plates
    .map(([slug, credit, dir]) => {
      const [era, med, mov] = taxonomy[slug].split(" ")
      return figure(slug, credit, dir, `plate p-era-${era} p-med-${med} p-mov-${mov}`)
    })
    .join("\n")

  return (
    head +
    `Filter the wall by when a work was made, what it was made with, or the movement ` +
    `it belongs to. Choices combine, and every plate keeps its caption.\n\n` +
    `<div class="gal">${radios()}\n${filters(counts, count)}\n` +
    `<div class="gal-body">\n<div class="gallery">\n${figures}\n</div>\n` +
    `<p class="gal-empty">No plates sit in all three of those at once — widen one of them.</p>\n` +
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
  await writeFile(
    join(import.meta.dirname, "content/library.md"),
    libraryMarkdown(credits, libCredits, taxonomy),
  )
  console.log(
    `wrote content/library.md (${Object.keys(credits).length} heroes + ${Object.keys(libCredits).length} library)`,
  )
}
