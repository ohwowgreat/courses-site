#!/usr/bin/env node
// Grow the Image-library gallery (Option A: curated public-domain, in git).
//
// Downsamples a bounded batch of public-domain works from the shared library
// into quartz/static/img/lib/ and writes their captions to library-credits.json.
// gallery.mjs merges these with the hand-curated hero plates (credits.json) into
// the single library page.
//
// Selection is restricted to works the index (image-library.json) tags
// public-domain — an explicit pre-1930 date in the filename, matching the policy
// in images.mjs. In-copyright works are never downsampled here. Works are picked
// round-robin across categories so the wall stays varied, capped at CAP (default
// 200). Re-runnable: it overwrites lib/ and library-credits.json each time.

import { execFile } from "node:child_process"
import { mkdir, writeFile, readFile, access, rm } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const LIB = process.env.LIB ?? "/Users/dogan/Documents/Vaults/Courses/raw/shared/Image Slides"
const OUT = join(import.meta.dirname, "quartz/static/img/lib")
const CAP = Number(process.env.CAP ?? 200)

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)

// Caption from the filename, plain text (no italics — the filenames are too
// irregular to reliably locate a title, and a mis-italicised date reads worse
// than none). Strips the usual file-noise: dimensions, medium, underscores.
// Heroes keep their hand-written, italicised captions in credits.json.
function caption(rel) {
  return rel
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .replace(/\(\s*\d[\d.,]*\s*[x×]\s*\d[\d.,]*\s*(cm|in)?\.?\s*\)/gi, "") // (141 x 122)
    .replace(
      /,?\s*(oil on canvas|oil on panel|oil on board|tempera[^,]*|gouache on paper|ink and colou?r on paper|pen and brown ink[^,]*|woodblock print[^,]*|chalk[^,]*)/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/[,\s]+$/, "")
    .trim()
}

const index = JSON.parse(await readFile(join(import.meta.dirname, "image-library.json"), "utf8"))

// Group public-domain candidates by category, then interleave for variety.
const byCat = {}
for (const it of index.items) {
  if (it.tier !== "public-domain") continue
  ;(byCat[it.category] ??= []).push(it)
}
for (const list of Object.values(byCat)) list.sort((a, b) => a.path.localeCompare(b.path))

const order = Object.keys(byCat).sort()
const picked = []
for (let round = 0; picked.length < CAP; round++) {
  let advanced = false
  for (const cat of order) {
    const it = byCat[cat][round]
    if (!it) continue
    advanced = true
    picked.push(it)
    if (picked.length >= CAP) break
  }
  if (!advanced) break
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const libCredits = {}
const seen = new Set()
let done = 0
for (const it of picked) {
  let slug = slugify(it.path.split("/").pop())
  if (!slug) continue
  while (seen.has(slug)) slug += "-x"
  seen.add(slug)

  const src = join(LIB, it.path)
  try {
    await access(src)
  } catch {
    continue
  }
  const dest = join(OUT, `${slug}.jpg`)
  try {
    await run("sips", [
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "78",
      "-Z",
      "1200",
      src,
      "--out",
      dest,
    ])
  } catch {
    console.error("  skip (sips failed):", it.path)
    continue
  }
  libCredits[slug] = caption(it.path)
  if (++done % 25 === 0) console.log(`  ${done}/${picked.length}`)
}

await writeFile(
  join(import.meta.dirname, "library-credits.json"),
  JSON.stringify(libCredits, null, 2) + "\n",
)
console.log(`\n${done} library plates → quartz/static/img/lib/, captions → library-credits.json`)
