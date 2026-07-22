#!/usr/bin/env node
// Select artworks from the shared Image Slides library, resize them for the web,
// and write them into the site's static directory with credits.
//
// The library is 7.2 GB of museum scans (one file is 38,414 px wide). Nothing is
// served from it directly — everything here is downsampled to web size first.
//
// Selection is deliberately restricted to work published before ~1930, which is
// public domain in the relevant jurisdictions — plus works of the US federal
// government (FSA photography: Lange's Migrant Mother), which are public domain
// by statute regardless of date. The library also holds in-copyright photography
// (Tillmans, Gursky, Sherman, Weems) that is fine to project in a classroom but
// not to republish on a website.

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
  // 9607 Media Studies L01 — the mediation demo (added 2026-07-22).
  {
    slug: "seventh-regiment",
    file: "Photographers/Underwood and Underwood/Underwood and Underwood - Mother, Wife, and Sweetheart Watching Boys of the Seventh Regimen as They Marched Away to War.jpg",
    credit:
      "Underwood & Underwood, *Mother, Wife, and Sweetheart Watching Boys of the Seventh Regiment as They Marched Away to War*, c. 1917 — the caption tells you who they are and how to feel",
  },
  {
    slug: "rebel-sharpshooter",
    file: "Photographers/Alexander Gardner/Alexander Gardner - Home of a Rebel Sharpshooter, Gettysburg from Gardner's Photographic Sketchbook of the War,.jpg",
    credit:
      "Alexander Gardner, *Home of a Rebel Sharpshooter*, 1863 — the soldier's body was moved and posed for the composition",
  },
  {
    slug: "migrant-mother",
    file: "Photographers/Dorothea Lange/Dorothea Lange, Migrant Mother, 1936.jpg",
    credit:
      "Dorothea Lange, *Migrant Mother*, 1936 — one frame chosen from six exposures, then cropped",
  },
  // 9607 U2 Media Language (added 2026-07-22).
  {
    slug: "skull-cigarette",
    file: "Vincent Van Gogh, Skull with Burning Cigarette, 1885.jpg",
    credit:
      "Vincent van Gogh, *Skull of a Skeleton with Burning Cigarette*, 1885 — what it shows is simple; what it suggests is the lesson",
  },
  {
    slug: "mummy-portrait",
    file: "Ancient Roman, Mummy Portrait of a Man Wearing an Ivy Wreath, 101.jpeg",
    credit:
      "Mummy portrait of a man wearing an ivy wreath, Roman Egypt, c. 101 CE — wreath, gold, gaze: codes at work for 1,900 years",
  },
  {
    slug: "calling-of-matthew",
    file: "Caravaggio, The Calling of Saint Matthew, 1599.jpg",
    credit:
      "Caravaggio, *The Calling of Saint Matthew*, 1599 — one light source, five gestures: a room you can read",
  },
  {
    slug: "nadar-taylor",
    file: "Photographers/Nadar/Nadar - Baron Isidore Taylor.jpg",
    credit: "Nadar, *Baron Isidore Taylor*, c. 1865 — an icon: it means by resembling",
  },
  {
    slug: "talbot-lace-index",
    file: "Photographers/William Henry Fox Talbot/William Henry Fox Talbot - Lace.jpg",
    credit:
      "William Henry Fox Talbot, *Lace*, c. 1844 — an index: made by direct contact with the thing itself",
  },
  {
    slug: "deer-mandala",
    file: "Unsorted/Deer Mandala of the Kasuga Shrine, first half 15th century.jpeg",
    credit:
      "*Deer Mandala of the Kasuga Shrine*, 15th century — a symbol: it means by convention alone",
  },
  {
    slug: "vanitas-schaak",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/B. Schaak. Still life Vanitas (vanity) (1675-1700) (Amsterdam, State museum).jpg",
    credit:
      "B. Schaak, *Vanitas Still Life*, 1675–1700 — skull, lantern, hourglass, book: the genre's repertoire",
  },
  {
    slug: "vanitas-schoor",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/Aelbert Jansz. van der Schoor. Still life Vanitas (vanity) (1640-1672) (Amsterdam, State museum).jpg",
    credit:
      "Aelbert van der Schoor, *Vanitas Still Life*, c. 1660 — the same codes, a different picture: repetition and difference",
  },
  {
    slug: "at-the-telephone",
    file: "Photographers/Aleksandr Rodchenko/Aleksandr Rodchenko - At the Telephone.jpg",
    credit:
      "Aleksandr Rodchenko, *At the Telephone*, 1928 — name the camera position; then name what it does to you",
  },
  {
    slug: "banqueting-sketch",
    file: "Unsorted/Multiple_Sketch_for_the_Banqueting_House_Ceiling.jpg",
    credit:
      "Peter Paul Rubens, sketch for the Banqueting House ceiling, c. 1630 — a plan another hand could paint from",
  },
  {
    slug: "peasant-wedding",
    file: "Pieter Bruegel the Elder, The Peasant Wedding, 1567, oil on panel, 114 cm × 164 cm.jpg",
    credit:
      "Pieter Bruegel the Elder, *The Peasant Wedding*, 1567 — every figure a function: bride, piper, steward, pourer",
  },
  // 9607 U3 Macro & Textual Analysis (added 2026-07-22).
  {
    slug: "whittier-classroom",
    file: "Photographers/Frances Benjamin Johnston/Frances Benjamin Johnston - English Literature, Lesson on Whittier, Middle Class, The Hampton Institute, Hampton, Virginia.jpg",
    credit:
      "Frances Benjamin Johnston, *English Literature — Lesson on Whittier*, Hampton Institute, 1899",
  },
  {
    slug: "hampton-geography",
    file: "Photographers/Frances Benjamin Johnston/Frances Benjamin Johnston - Geography, Studying the Seasons, The Hampton Institute, Hampton, Virginia.jpg",
    credit:
      "Frances Benjamin Johnston, *Geography — Studying the Seasons*, Hampton Institute, 1899 — work checked together, in the room",
  },
  {
    slug: "vivarini-exorcism",
    file: "Antonio Vivarini, Saint Peter Martyr Exorcizing a Woman Possessed by a Devil, c. 1450.jpg",
    credit:
      "Antonio Vivarini, *Saint Peter Martyr Exorcizing a Woman Possessed by a Devil*, c. 1450 — hero, villain, victim, helpers: Propp's functions, five centuries early",
  },
  {
    slug: "wanderer",
    file: "Caspar David Friedrich, Wanderer Above the Sea of Fog, Oil on canvas, 1818.jpeg",
    credit:
      "Caspar David Friedrich, *Wanderer Above the Sea of Fog*, 1818 — who is he? what does he see? the enigma code at work",
  },
  // 9607 U4 Representation (added 2026-07-22).
  {
    slug: "kasebier-wild-west",
    file: "Photographers/Gertrude Käsebier/American Indian Portrait, Gertrude Käsebier, c. 1899.jpg",
    credit:
      "Gertrude Käsebier, *American Indian Portrait*, c. 1899 — a studio construction: who made the choices in this image, and for whom?",
  },
  {
    slug: "lincoln-mcclellan",
    file: "Photographers/Alexander Gardner/Alexander Gardner, Abraham Lincoln and George McClellan, 1862 (printed c. 1890) .jpeg",
    credit:
      "Alexander Gardner, *Lincoln and McClellan at Antietam*, 1862 — the photo-op is older than the word",
  },
  {
    slug: "folies-bergere",
    file: "Edouard Manet, Un bar aux Folies Bergère, 1882.jpg",
    credit:
      "Édouard Manet, *A Bar at the Folies-Bergère*, 1882 — who is looking at whom? the mirror refuses to agree",
  },
  {
    slug: "cahun-gaze",
    file: "Claude Cahun, Self-Portrait, 1920.jpeg",
    credit: "Claude Cahun, *Self-Portrait*, 1920 — a look sent back: the gaze refused",
  },
  {
    slug: "rivera-self-portrait",
    file: "Diego Rivera, Self-Portrait, 1907.jpeg",
    credit: "Diego Rivera, *Self-Portrait*, 1907 — the maker examining himself",
  },
  // 9607 U5 Media Contexts (added 2026-07-22).
  {
    slug: "good-glass-of-beer",
    file: "Edouard Manet, A Good Glass of Beer, 1873.jpeg",
    credit: "Édouard Manet, *A Good Glass of Beer*, 1873 — gratification, personified",
  },
  {
    slug: "above-fifth-avenue",
    file: "Photographers/Underwood and Underwood/Underwood and Underwood - Above Fifth Avenue, Looking North.jpg",
    credit:
      "Underwood & Underwood, *Above Fifth Avenue, Looking North*, c. 1905 — the industry at work: somebody pays for this vantage",
  },
  {
    slug: "emperors-table",
    file: "Photographers/Gustave Le Gray/Preparation of the Emperor's Table, Camp de Châlons, Gustave Le Gray, 1857 .jpg",
    credit:
      "Gustave Le Gray, *Preparation of the Emperor's Table, Camp de Châlons*, 1857 — photographed on imperial commission: the frame belonged to the payer",
  },
  {
    slug: "lindbergh-1927",
    file: "Photographers/Underwood and Underwood/Charles Lindbergh, Underwood & Underwood, 1927.jpg",
    credit:
      "Underwood & Underwood, *Charles Lindbergh*, 1927 — the first global media event: one man, every channel",
  },
  // 9607 U6 Revision (added 2026-07-22) — the S1 build complete.
  {
    slug: "moon-atlas",
    file: "Photographers/Maurice Loewy and Pierre Henri Puiseux/Maurice Loewy and Pierre Henri Puiseux - The Moon from Atlas Photographique de la lune..jpg",
    credit:
      "Loewy & Puiseux, plate from the *Atlas Photographique de la Lune*, c. 1900 — the whole surface, plate by plate, so no region goes unexamined",
  },
  {
    slug: "musicians",
    file: "Caravaggio, Musicians, 1595.jpeg",
    credit: "Caravaggio, *The Musicians*, 1595 — rehearsal, mid-note",
  },
  {
    slug: "the-magpie",
    file: "Claude Monet, The Magpie, 1869.jpg",
    credit: "Claude Monet, *The Magpie*, 1869 — winter light, and the quiet after",
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
