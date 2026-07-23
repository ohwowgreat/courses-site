#!/usr/bin/env node
// Index the shared Image Slides library into a catalog the site can reference.
//
// Metadata only — this never copies image bytes anywhere. It records artist,
// title, year, folder and a public-domain / in-copyright classification (by the
// year in the filename, following the README's ~1930 line) so that:
//   - the gallery build can DISPLAY only the public-domain tier, and
//   - lesson/unit pages can CITE any work in the library, displayed or not.
//
// Reads raw/ (like images.mjs) but writes only image-library.json.

import { readdir, writeFile } from "node:fs/promises"
import { join, relative, extname } from "node:path"

const LIB = process.env.LIB ?? "/Users/dogan/Documents/Vaults/Courses/raw/shared/Image Slides"
const OUT = join(import.meta.dirname, "image-library.json")
const IMG = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".gif"])
const PD_CUTOFF = 1930 // README's heuristic; life+70 is the real test — treat as approximate.

async function walk(dir) {
  const out = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await walk(p)))
    else if (IMG.has(extname(ent.name).toLowerCase())) out.push(p)
  }
  return out
}

function parse(rel) {
  const name = rel.split("/").pop()
  const base = name.replace(/\.[^.]+$/, "")
  let year = null
  for (const m of base.matchAll(/1[2-9][0-9]{2}|20[0-2][0-9]/g)) {
    const y = +m[0]
    if (y >= 1200 && y <= 2026 && (year === null || y > year)) year = y
  }
  const category = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)"
  const artist = base.includes(",") ? base.slice(0, base.indexOf(",")).trim() : null
  const tier = year === null ? "unknown" : year < PD_CUTOFF ? "public-domain" : "in-copyright"
  return { path: rel, category, artist, year, tier }
}

const files = await walk(LIB)
const items = files.map((p) => parse(relative(LIB, p))).sort((a, b) => a.path.localeCompare(b.path))

const count = (key) => items.reduce((m, it) => ((m[it[key]] = (m[it[key]] || 0) + 1), m), {})

await writeFile(
  OUT,
  JSON.stringify({ source: "Image Slides", total: items.length, items }, null, 2),
)

console.log(`indexed ${items.length} images → image-library.json`)
console.log("by tier:      ", count("tier"))
console.log(
  "displayable (public-domain by date):",
  items.filter((i) => i.tier === "public-domain").length,
)
const cats = count("category")
console.log(
  "top categories:",
  Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8),
)
