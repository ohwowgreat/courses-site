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
  // PAL S1 U1 lesson heroes (added 2026-07-20)
  {
    slug: "first-marks",
    file: "Ilya Repin (Drawings)/Ilya Repin, Lev Nikolaevich Tolstoy at Work, 1891.jpg",
    credit: "Ilya Repin, *Leo Tolstoy at Work*, 1891",
  },
  {
    slug: "tone-and-form",
    // Filename says 1923 — a mislabel; the chalk drawing is c. 1619 (Albertina).
    file: "Unsorted/Head of a Boy  (Nicolaas Rubens) ,1923.jpg",
    credit: "Peter Paul Rubens, *Head of a Boy (Nicolaas Rubens)*, c. 1619",
  },
  {
    slug: "mark-making",
    file: "Unsorted/Anatomical Studies, Peter Paul Rubens, Pen and brown ink, 27.9 x 18.7 cm, 1605t.jpg",
    credit: "Peter Paul Rubens, *Anatomical Studies*, pen and ink, c. 1605",
  },
  {
    slug: "composition",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/Clara Peeters (1589-94 - after 1657)/Still-life with cheese, almonds and pretzels (about 1613) (35 x 50) (The Hague, the king. Gallery Mauritshuis).jpg",
    credit: "Clara Peeters, *Still Life with Cheeses, Almonds and Pretzels*, c. 1613",
  },
  {
    slug: "drawn-from-life",
    file: "Ilya Repin (Drawings)/Ilya Repin, Portrait of a Russian Peasant, 1871.jpg",
    credit: "Ilya Repin, *Portrait of a Russian Peasant*, 1871",
  },
  // PAL S1 U2 photography heroes + inline figures (added 2026-07-21).
  // All pre-1930 public domain, per the policy above.
  {
    slug: "the-great-wave",
    file: "Photographers/Gustave Le Gray/Gustave Le Gray - The Great Wave, Sète.jpg",
    credit: "Gustave Le Gray, *The Great Wave, Sète*, 1857",
  },
  {
    slug: "sea-of-steps",
    file: "Photographers/Frederick H. Evans/Frederick H. Evans - A Sea of Steps, Wells Cathedral.jpg",
    credit: "Frederick H. Evans, *A Sea of Steps, Wells Cathedral*, 1903",
  },
  {
    slug: "st-pauls-spires",
    file: "Photographers/Alvin Langdon Coburn/Alvin Langdon Coburn - St. Paul's and Other Spires.jpg",
    credit: "Alvin Langdon Coburn, *St. Paul's and Other Spires*, c. 1909",
  },
  {
    slug: "canon-de-chelle",
    file: "Photographers/Timothy O'Sullivan/Ancient Ruins in the Cañon de Chelle, New Mexico. In a Niche Fifty Feet Above Present Cañon Bed, Timothy O'Sullivan, 1873.jpg",
    credit: "Timothy O'Sullivan, *Ancient Ruins in the Cañon de Chelle*, 1873",
  },
  {
    slug: "lincoln-cathedral",
    file: "Photographers/Frederick H. Evans/Lincoln Cathedral From the Castle, Frederick H. Evans, 1898.jpg",
    credit: "Frederick H. Evans, *Lincoln Cathedral From the Castle*, 1898",
  },
  {
    slug: "girl-with-washington",
    file: "Photographers/Southworth & Hawes/Southworth and Hawes, [Girl with Portrait of George Washington], ca. 1850.jpeg",
    credit: "Southworth & Hawes, *Girl with Portrait of George Washington*, c. 1850",
  },
  {
    slug: "kasebier-portrait",
    file: "Photographers/Gertrude Käsebier/Gertrude Käsebier, Portrait, c. 1905.jpg",
    credit: "Gertrude Käsebier, *Portrait*, c. 1905",
  },
  {
    slug: "the-tugboat",
    file: "Photographers/Gustave Le Gray/Gustave Le Gray, The Tugboat, 1857.jpeg",
    credit: "Gustave Le Gray, *The Tugboat*, 1857",
  },
  {
    slug: "cloud-sequence",
    file: "Photographers/Alfred Stieglitz/Music – A Sequence of Ten Cloud Photographs, No. 1 by Alfred Stieglitz.jpg",
    credit: "Alfred Stieglitz, *Music: A Sequence of Ten Cloud Photographs, No. 1*, 1922",
  },
  {
    slug: "articles-of-glass",
    file: "Photographers/William Henry Fox Talbot/Articles of Glass, William Henry Fox Talbot, 1844.jpg",
    credit: "William Henry Fox Talbot, *Articles of Glass*, 1844",
  },
  {
    slug: "yosemite-mosquito-camp",
    file: "Photographers/Eadweard J. Muybridge/Eadweard J. Muybridge, Valley of the Yosemite. From Mosquito Camp, 1872.jpg",
    credit: "Eadweard Muybridge, *Valley of the Yosemite, from Mosquito Camp*, 1872",
  },
  {
    slug: "yosemite-rocky-ford",
    file: "Photographers/Eadweard J. Muybridge/Valley of the Yosemite, from Rocky Ford, 1872 .jpg",
    credit: "Eadweard Muybridge, *Valley of the Yosemite, from Rocky Ford*, 1872",
  },
  {
    slug: "atget-rue-moliere",
    file: "Photographers/Eugène Atget/108 rue Molière, Eugène Atget, 1908.jpg",
    credit: "Eugène Atget, *108 rue Molière*, 1908",
  },
  {
    slug: "atget-rue-mazet",
    file: "Photographers/Eugène Atget/10 de la Rue Mazet, Eugène Atget, 1907 .jpg",
    credit: "Eugène Atget, *10 rue Mazet*, 1907",
  },
  {
    slug: "atget-avenue-de-suffren",
    file: "Photographers/Eugène Atget/106 avenue de Suffren, Eugène Atget, 1907.jpg",
    credit: "Eugène Atget, *106 avenue de Suffren*, 1907",
  },
  {
    slug: "atget-rue-mazarine",
    file: "Photographers/Eugène Atget/21 Rue Mazarine (Cour), Eugène Atget, 1911.jpg",
    credit: "Eugène Atget, *21 rue Mazarine*, 1911",
  },
  {
    slug: "yosemite-fall",
    file: "Photographers/Carleton E. Watkins/Carleton E. Watkins, Lower Yosemite Fall, 1,600 feet, ca. 1872, printed ca. 1876.jpeg",
    credit: "Carleton Watkins, *Lower Yosemite Fall*, c. 1872",
  },
  // PAL S1 U3 collage heroes + inline figures (added 2026-07-21).
  // Pre-1930 publication throughout, per the policy above.
  {
    slug: "guitar-gas-jet",
    file: "Pablo Picasso/Pablo Picasso, Guitar, Gas-Jet and Bottle, 1913.JPG",
    credit: "Pablo Picasso, *Guitar, Gas-Jet and Bottle*, 1913",
  },
  {
    slug: "kahnweiler",
    file: "Pablo Picasso/Pablo Picasso, Portrait of Daniel-Henry Kahnweiler, 1910.JPG",
    credit: "Pablo Picasso, *Portrait of Daniel-Henry Kahnweiler*, 1910",
  },
  {
    slug: "lissitzky-schwitters",
    file: "Photographers/El Lissitzky/El Lissitzky - Kurt Schwitters.jpg",
    credit: "El Lissitzky, *Kurt Schwitters*, c. 1924 — a photomontage portrait of the great collagist",
  },
  {
    slug: "talbot-lace",
    file: "Photographers/William Henry Fox Talbot/William Henry Fox Talbot - Lace.jpg",
    credit: "William Henry Fox Talbot, *Lace*, c. 1844",
  },
  {
    slug: "rubens-title-page",
    file: "Unsorted/Design for the title-page of Hermannus Hugo Obsidio Bredana，1626.png",
    credit: "Peter Paul Rubens, title-page design for *Obsidio Bredana*, 1626",
  },
  {
    slug: "vanitas",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/Edwaert Collier (about 1640 - after 1707). Still life Vanitas (vanity) (1662) (Amsterdam, State museum).jpg",
    credit: "Edwaert Collier, *Vanitas Still Life*, 1662",
  },
  {
    slug: "impossible-bouquet",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/Ambrosius Bosschaert the Elder (1573-1621)/Bouquet of flowers in earthenware vase (1609-1610) London, Nat. gallery).jpg",
    credit: "Ambrosius Bosschaert the Elder, *A Still Life of Flowers*, 1609–10 — flowers that never bloom together, composed anyway",
  },
  {
    slug: "assembling",
    file: "Photographers/Aleksandr Rodchenko/Aleksandr Rodchenko - Assembling for a Demonstration.jpg",
    credit: "Aleksandr Rodchenko, *Assembling for a Demonstration*, 1928",
  },
  {
    slug: "cahun-self-portrait",
    file: "Claude Cahun, Self-Portrait, 1920.jpeg",
    credit: "Claude Cahun, *Self-Portrait*, 1920",
  },
  // PAL S1 U4 poster-route heroes + inline figures (added 2026-07-21).
  {
    slug: "mucha-poster",
    file: "Alphonse Mucha, Calendar of cherry blossom, 1898.jpeg",
    credit: "Alphonse Mucha, *Calendar of Cherry Blossom*, 1898",
  },
  {
    slug: "gsell-advertisement",
    file: "Photographers/Emile Gsell/Photographic Advertisement - 1860s.jpg",
    credit: "Émile Gsell, photographic advertisement, 1860s — one name card commanding a hundred photographs",
  },
  {
    slug: "kawase-temple",
    file: "Hasui Kawase, Zôjô-ji Temple in Shiba, 1925, the series Twenty Views of Tokyo, Woodblock print; ink and color on paper.jpeg",
    credit: "Hasui Kawase, *Zôjô-ji Temple in Shiba*, 1925 — a print designed to circulate",
  },
  {
    slug: "pioneer-girl",
    file: "Photographers/Aleksandr Rodchenko/Aleksandr Rodchenko - Pioneer Girl.jpg",
    credit: "Aleksandr Rodchenko, *Pioneer Girl*, 1930",
  },
  {
    slug: "album-leaf",
    file: "Aoki Shukuya, Double Album of Landscape Studies after Ikeno Taiga, Volume 2 (leaf 15), 18th century.jpeg",
    credit: "Aoki Shukuya, *Double Album of Landscape Studies after Ikeno Taiga*, 18th century",
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
