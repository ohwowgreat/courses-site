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

export function libraryMarkdown(credits) {
  const figures = Object.entries(credits)
    .map(([slug, credit]) => {
      const caption = credit.replace(/\*([^*]+)\*/g, "<em>$1</em>")
      const alt = credit.replace(/\*/g, "").replace(/"/g, "&quot;")
      return (
        `  <figure class="plate">\n` +
        `    <img src="static/img/${slug}.jpg" alt="${alt}" loading="lazy" />\n` +
        `    <figcaption>${caption}</figcaption>\n` +
        `  </figure>`
      )
    })
    .join("\n")

  const count = Object.keys(credits).length
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
  const credits = JSON.parse(await readFile(join(import.meta.dirname, "credits.json"), "utf8"))
  await writeFile(join(import.meta.dirname, "content/library.md"), libraryMarkdown(credits))
  console.log(`wrote content/library.md (${Object.keys(credits).length} plates)`)
}
