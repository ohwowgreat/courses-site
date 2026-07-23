#!/usr/bin/env node
// Build the single "Image library" gallery page from the downsampled plates.
//
// Reads credits.json (slug → caption, written by images.mjs) and emits a Quartz
// content page: one responsive grid of every plate the site hosts. Only works
// already downsampled into quartz/static/img/ appear here — the same pre-1930
// public-domain set images.mjs is deliberately restricted to. In-copyright works
// are never added to this page; lessons cite those by name instead.
//
// Imported by sync.mjs (which writes content/library.md each run) and runnable
// standalone for a quick preview: `node gallery.mjs`.

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

function figure(slug, credit, dir) {
  const caption = credit.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  const alt = credit.replace(/\*/g, "").replace(/"/g, "&quot;")
  return (
    `  <figure class="plate">\n` +
    `    <img src="static/img/${dir}${slug}.jpg" alt="${alt}" loading="lazy" />\n` +
    `    <figcaption>${caption}</figcaption>\n` +
    `  </figure>`
  )
}

// `credits` are the hand-curated hero plates (quartz/static/img/); `libCredits`
// are the bulk public-domain batch from library-images.mjs (…/img/lib/).
export function libraryMarkdown(credits, libCredits = {}) {
  const figures = [
    ...Object.entries(credits).map(([slug, credit]) => figure(slug, credit, "")),
    ...Object.entries(libCredits).map(([slug, credit]) => figure(slug, credit, "lib/")),
  ].join("\n")

  const count = Object.keys(credits).length + Object.keys(libCredits).length
  return (
    `---\n` +
    `title: Image library\n` +
    `---\n\n` +
    `# Image library\n\n` +
    `Every image used across these courses, gathered in one place — ${count} public-domain ` +
    `works from the shared teaching collection, each captioned with artist, title and date. ` +
    `In-copyright works studied in class are named in the lessons rather than shown here.\n\n` +
    `<div class="gallery">\n${figures}\n</div>\n`
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
  await writeFile(
    join(import.meta.dirname, "content/library.md"),
    libraryMarkdown(credits, libCredits),
  )
  console.log(
    `wrote content/library.md (${Object.keys(credits).length} heroes + ${Object.keys(libCredits).length} library)`,
  )
}
