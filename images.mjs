#!/usr/bin/env node
// Select artworks from the shared Image Slides library, resize them for the web,
// and write them into the site's static directory with credits.
//
// The library is 7.2 GB of museum scans (one file is 38,414 px wide). Nothing is
// served from it directly — everything here is downsampled to web size first.
//
// Selection is deliberately restricted to work published before ~1930, which is
// public domain in the relevant jurisdictions. The library also holds in-copyright
// photography (Tillmans, Gursky, Sherman, Weems) that is fine to project in a
// classroom but not to republish on a website.

import { execFile } from "node:child_process"
import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const LIB = "/Users/dogan/Documents/Vaults/Courses/raw/shared/Image Slides"
const OUT = join(import.meta.dirname, "quartz/static/img")

// slug, source file, credit line, and an optional pre-crop for extreme aspect ratios.
const PLATES = [
  {
    slug: "home",
    file: "Zhang Zeduan, Along the River During the Qingming Festival, 1085-1145.jpg",
    credit: "Zhang Zeduan, *Along the River During the Qingming Festival* (detail), 12th century",
    // A 38,414 × 1,800 handscroll. Scaled whole it would be 112 px tall, so take a
    // 3:1 section from the middle — the bridge passage — before downsampling.
    crop: [1800, 5400],
  },
  {
    slug: "a-level-art-design",
    file: "Paul Cezanne, A Painter at Work, 1875.jpeg",
    credit: "Paul Cézanne, *A Painter at Work*, 1875",
  },
  {
    slug: "media-studies",
    file: "Edouard Manet, Un bar aux Folies Bergère, 1882.jpg",
    credit: "Édouard Manet, *A Bar at the Folies-Bergère*, 1882",
  },
  {
    slug: "art-appreciation",
    file: "Pieter Bruegel the Elder, The Peasant Wedding, 1567, oil on panel, 114 cm × 164 cm.jpg",
    credit: "Pieter Bruegel the Elder, *The Peasant Wedding*, 1567",
  },
  {
    slug: "pre-a-level-art-design",
    file: "Alphonse Mucha, Calendar of cherry blossom, 1898.jpeg",
    credit: "Alphonse Mucha, *Calendar of Cherry Blossom*, 1898",
  },
  {
    slug: "oxbridge",
    file: "Raphael, School of Athens, 1509-1511, Fresco.jpg",
    credit: "Raphael, *The School of Athens*, 1509–11",
  },
  {
    slug: "representation",
    file: "Kitagawa Utamaro, Two Women by a Bamboo Blind, c. 1797 or 1798.jpg",
    credit: "Kitagawa Utamaro, *Two Women by a Bamboo Blind*, c. 1797",
  },
  {
    slug: "observation",
    file: "Vincent van Gogh, The Potato Peeler (reverse- Self-Portrait with a Straw Hat), 1885.jpeg",
    credit: "Vincent van Gogh, *The Potato Peeler*, 1885",
  },
  {
    slug: "the-table",
    file: "Jan Steen, The Merry Family, 1668, oil on canvas.jpg",
    credit: "Jan Steen, *The Merry Family*, 1668",
  },
  {
    slug: "calendar",
    file: "Pieter Bruegel the Elder, The Hunters in the Snow, 1565, oil on panel, 117 cm × 162 cm.jpg",
    credit: "Pieter Bruegel the Elder, *The Hunters in the Snow*, 1565",
  },
]

await mkdir(OUT, { recursive: true })

const credits = {}
for (const plate of PLATES) {
  const src = join(LIB, plate.file)
  try {
    await access(src)
  } catch {
    console.error(`  missing, skipped: ${plate.file}`)
    continue
  }

  const dest = join(OUT, `${plate.slug}.jpg`)
  const fmt = ["-s", "format", "jpeg", "-s", "formatOptions", "80"]

  if (plate.crop) {
    // Two passes: sips reorders -c and -Z within a single invocation, resampling
    // before it crops, which collapses a 38,414 px panorama to a few hundred px.
    await run("sips", [...fmt, "-c", String(plate.crop[0]), String(plate.crop[1]), src, "--out", dest])
    await run("sips", [...fmt, "-Z", "2000", dest, "--out", dest])
  } else {
    await run("sips", [...fmt, "-Z", "2000", src, "--out", dest])
  }
  credits[plate.slug] = plate.credit
  console.log(`  ${plate.slug}.jpg`)
}

// sync.mjs reads this to attach a credit line under each image.
await writeFile(join(import.meta.dirname, "credits.json"), JSON.stringify(credits, null, 2) + "\n")
console.log(`\n${Object.keys(credits).length} plates written to quartz/static/img/`)
