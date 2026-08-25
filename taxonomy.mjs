#!/usr/bin/env node
// Classify every plate on the Image-library page by era, medium and movement.
//
// The three filter axes on /library. Era is mechanical (the year in the caption);
// medium and movement are art-historical judgements, so they come from a table of
// artists and source folders here and are then FROZEN into library-taxonomy.json.
//
// Frozen because the build host has neither the vault nor image-library.json — it
// sees only the committed credits files. So this script runs locally and commits
// its answer; gallery.mjs just reads it. Re-running never overwrites a slug that
// is already in the file, which is what makes library-taxonomy.json hand-editable:
// correct a line there and it survives the next batch of images.
//
//   node taxonomy.mjs          classify any plates not yet in library-taxonomy.json
//   node taxonomy.mjs --all    reclassify every plate from these rules, discarding edits

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const HERE = import.meta.dirname

// ── The vocabulary ───────────────────────────────────────────────────────────
// Each axis is a fixed, ordered list — the order is the order of the filter chips.
// gallery.mjs generates its CSS from these, so adding a value here is the only
// edit a new category needs.

export const ERAS = [
  ["pre-1400", "Before 1400", 0],
  ["1400-1599", "1400–1599", 1400],
  ["1600-1699", "1600–1699", 1600],
  ["1700-1799", "1700–1799", 1700],
  ["1800-1899", "1800–1899", 1800],
  ["1900-1940", "1900–1940", 1900],
  ["1941-1999", "1941–1999", 1941],
  ["2000-now", "2000–now", 2000],
]

export const MEDIUMS = [
  ["painting", "Painting"],
  ["drawing", "Drawing"],
  ["print", "Print"],
  ["photograph", "Photograph"],
  ["collage", "Collage & montage"],
  ["object", "Object"],
  ["film-still", "Film & TV still"],
  ["bts", "Behind the scenes"],
  ["advert", "Advertising & magazines"],
]

export const MOVEMENTS = [
  ["ancient", "Ancient & classical"],
  ["early-renaissance", "Early Renaissance & Gothic"],
  ["renaissance", "Renaissance"],
  ["baroque", "Baroque & Dutch Golden Age"],
  ["romanticism", "Romanticism"],
  ["realism", "Realism"],
  ["impressionism", "Impressionism & after"],
  ["art-nouveau", "Art Nouveau"],
  ["modernism", "Modernism & avant-garde"],
  ["contemporary", "Contemporary art"],
  ["east-asian", "East Asian traditions"],
  ["early-photography", "Early photography"],
  ["documentary", "Documentary & reportage"],
  ["pictorialism", "Pictorialism"],
  ["modern-photography", "Modernist photography"],
  ["screen", "Cinema & television"],
  ["other", "Other"],
]

// The fourth filter row on /library is where a plate is USED, not what it is, so
// its values do not come from this classifier: sync.mjs derives them from its own
// placement tables (HEROES, FIGURES, the landing hero) and freezes the answer
// into library-usage.json on every run. "shared" is any placement outside
// classes/; "library" is a plate placed on no page at all.
export const COURSES = [
  ["a-level-art-design", "A-Level Art & Design"],
  ["pre-a-level-art-design", "Pre-A-Level Art & Design"],
  ["media-studies", "Media Studies"],
  ["art-appreciation", "Art Appreciation"],
  ["oxbridge", "Oxbridge"],
  ["shared", "Shared pages"],
  ["library", "Collection only"],
]

// ── The rules ────────────────────────────────────────────────────────────────

// artist → [medium, movement, activeFrom, activeTo]. The active years are a sanity
// check on the parsed date, not a fact about the work: several filenames carry an
// inventory number or a scan date where the year should be (a Repin drawing filed
// under "A II 1754", a run of Rubens sheets named only "Peter Paul Rubens1200"),
// and without a bound those land centuries away from the artist.
//
// The medium is the artist's default in THIS collection, not their whole practice:
// every Rubens here is a sheet or a modello, so Rubens defaults to drawing and the
// one oil sketch is corrected in SLUGS below.
const ARTISTS = {
  "Zhang Zeduan": ["painting", "east-asian", 1085, 1145],
  "Chen Hongshou": ["painting", "east-asian", 1598, 1652],
  "Kitagawa Utamaro": ["print", "east-asian", 1780, 1806],
  "Hasui Kawase": ["print", "east-asian", 1918, 1957],
  "Aoki Shukuya": ["painting", "east-asian", 1760, 1796],

  "Antonio Vivarini": ["painting", "early-renaissance", 1440, 1476],
  "Bernardino Fungai": ["painting", "early-renaissance", 1480, 1516],
  "Sandro Botticelli": ["painting", "early-renaissance", 1470, 1510],
  "Andrea Previtali": ["painting", "renaissance", 1502, 1528],
  "Leonardo da Vinci": ["painting", "renaissance", 1470, 1519],
  Raphael: ["painting", "renaissance", 1500, 1520],
  Titian: ["painting", "renaissance", 1508, 1576],
  Bronzino: ["painting", "renaissance", 1530, 1572],
  "Pieter Bruegel the Elder": ["painting", "renaissance", 1550, 1569],

  Caravaggio: ["painting", "baroque", 1592, 1610],
  "Artemisia Gentileschi": ["painting", "baroque", 1610, 1656],
  "Frans Snyders": ["painting", "baroque", 1600, 1657],
  "Dirck van Deelen": ["painting", "baroque", 1625, 1671],
  "Peter Paul Rubens": ["drawing", "baroque", 1598, 1640],
  "Jan Steen": ["painting", "baroque", 1648, 1679],
  "Willem Claesz. Heda": ["painting", "baroque", 1620, 1664],
  "Clara Peeters": ["painting", "baroque", 1607, 1621],
  "Edwaert Collier": ["painting", "baroque", 1662, 1707],
  "Ambrosius Bosschaert the Elder": ["painting", "baroque", 1600, 1621],
  "Aelbert Jansz. van der Schoor": ["painting", "baroque", 1640, 1672],
  "Aelbert van der Schoor": ["painting", "baroque", 1640, 1672],
  "B. Schaak": ["painting", "baroque", 1675, 1700],
  "Bartholomeus van der Helst": ["painting", "baroque", 1636, 1670],

  "Caspar David Friedrich": ["painting", "romanticism", 1800, 1840],
  "Benjamin Champney": ["painting", "romanticism", 1845, 1890],

  "Ilya Yefimovich Repin": ["drawing", "realism", 1864, 1930],
  "Ilya Repin": ["drawing", "realism", 1864, 1930],
  "I.Repin": ["drawing", "realism", 1864, 1930],
  "Albert Edelfelt": ["painting", "realism", 1874, 1905],
  "Edward Hopper": ["painting", "realism", 1900, 1967],

  "Claude Monet": ["painting", "impressionism", 1865, 1926],
  "Camille Pissarro": ["painting", "impressionism", 1860, 1903],
  "Alfred Sisley": ["painting", "impressionism", 1865, 1899],
  "Édouard Manet": ["painting", "impressionism", 1860, 1883],
  "Vincent van Gogh": ["painting", "impressionism", 1881, 1890],
  "Paul Cézanne": ["painting", "impressionism", 1860, 1906],
  "Charles Angrand": ["painting", "impressionism", 1880, 1926],
  "Childe Hassam": ["painting", "impressionism", 1880, 1935],

  "Alphonse Mucha": ["print", "art-nouveau", 1890, 1910],

  "Pablo Picasso": ["painting", "modernism", 1900, 1930],
  "Diego Rivera": ["painting", "modernism", 1905, 1930],
  "Marcel Duchamp": ["object", "modernism", 1912, 1968],
  "Hannah Höch": ["collage", "modernism", 1916, 1978],

  // Post-war and contemporary. The active ranges run to the present where the
  // artist does, so a captioned exhibition or scan date cannot evict the work.
  "Andy Warhol": ["object", "contemporary", 1954, 1987],
  "Romare Bearden": ["collage", "contemporary", 1940, 1988],
  "Carrie Mae Weems": ["photograph", "contemporary", 1978, 2026],
  "Cindy Sherman": ["photograph", "contemporary", 1975, 2026],
  "Martha Rosler": ["film-still", "contemporary", 1965, 2026],

  // Named screen authors; title-only film and TV frames are in SLUGS below.
  "John Berger": ["film-still", "screen", 1960, 1990],
  "Ang Lee": ["film-still", "screen", 1990, 2026],
  "Jean-Luc Godard": ["film-still", "screen", 1954, 2022],
  "Alice Rohrwacher": ["film-still", "screen", 2011, 2026],

  "Joseph Nicéphore Niépce": ["photograph", "early-photography", 1816, 1833],
  "William Henry Fox Talbot": ["photograph", "early-photography", 1839, 1846],
  "Southworth & Hawes": ["photograph", "early-photography", 1843, 1862],
  "Gustave Le Gray": ["photograph", "early-photography", 1850, 1860],
  Nadar: ["photograph", "early-photography", 1854, 1880],
  "Émile Gsell": ["photograph", "early-photography", 1866, 1879],
  "Adolphe Braun": ["photograph", "early-photography", 1855, 1877],
  "Eadweard Muybridge": ["photograph", "early-photography", 1867, 1887],
  "Carleton Watkins": ["photograph", "early-photography", 1861, 1890],
  "Timothy O'Sullivan": ["photograph", "early-photography", 1862, 1875],

  "Alexander Gardner": ["photograph", "documentary", 1862, 1867],
  "Underwood & Underwood": ["photograph", "documentary", 1890, 1930],
  "Frances Benjamin Johnston": ["photograph", "documentary", 1890, 1910],
  "Dorothea Lange": ["photograph", "documentary", 1930, 1940],
  "Loewy & Puiseux": ["photograph", "documentary", 1894, 1910],

  "Gertrude Käsebier": ["photograph", "pictorialism", 1895, 1912],
  "Frederick H. Evans": ["photograph", "pictorialism", 1890, 1910],
  "Alvin Langdon Coburn": ["photograph", "pictorialism", 1900, 1917],

  "August Sander": ["photograph", "modern-photography", 1910, 1932],
  "André Kertész": ["photograph", "modern-photography", 1920, 1930],
  "Eugène Atget": ["photograph", "modern-photography", 1898, 1927],
  "Alfred Stieglitz": ["photograph", "modern-photography", 1900, 1930],
  "Aleksandr Rodchenko": ["photograph", "modern-photography", 1924, 1930],
  "Claude Cahun": ["photograph", "modern-photography", 1913, 1930],
  "El Lissitzky": ["photograph", "modern-photography", 1919, 1930],
}

// Source folder in the shared library → [medium, movement]. Weaker than the artist
// match and used to fill whichever half the artist left open: the still-life folder
// names no painter in most of its filenames, and the two "(Drawings)" folders say
// what the sheet is even when the artist table would have guessed a canvas.
const FOLDERS = {
  "Dutch and Flemish Still Life Painting (Art Paintings)": ["painting", "baroque"],
  "Peter Paul Rubens, 1577-1640 (Drawings)": ["drawing", "baroque"],
  "Ilya Repin (Drawings)": ["drawing", "realism"],
  "Pablo Picasso": ["painting", "modernism"],
  "Camille Pissarro": ["painting", "impressionism"],
  Photographers: ["photograph", null],
  Artifacts: ["object", "other"],
  Excavations: ["photograph", "documentary"],
}

// Per-slug corrections, for plates no rule can reach: works whose filename carries
// no artist, dates written in a form the year parser cannot read (BC, CE, "15th
// century"), and the handful the artist default gets wrong.
const SLUGS = {
  // Rubens sheets filed under Unsorted, their filenames stripped to a bare title.
  "a-naked-man-dropping-from-a-wall-1602": "1600-1699 drawing baroque",
  "ead-of-seneca-1608": "1600-1699 drawing baroque",
  "head-of-a-girl-1636": "1600-1699 drawing baroque",
  "head-of-a-girl-1636-x": "1600-1699 drawing baroque",
  "hercules-1620": "1600-1699 drawing baroque",
  "ignudo-turning-to-left-nude-figure-seated-almost-to-left-163": "1600-1699 drawing baroque",
  "lion-1612-13": "1600-1699 drawing baroque",
  "design-for-the-title-page-of-hermannus-hugo-obsidio-bredana-": "1600-1699 drawing baroque",
  // Filename dates the work 1923; it is the c. 1619 chalk study of Rubens' son.
  "head-of-a-boy-nicolaas-rubens-1923": "1600-1699 drawing baroque",
  // An oil modello, not a sheet — the one Rubens here that is not a drawing.
  "banqueting-sketch": "1600-1699 painting baroque",

  // Repin, in Cyrillic and so invisible to the artist scan.
  "l-e-i-i-i-1887": "1800-1899 drawing realism",
  // Repin's Tretyakov portrait of Tenisheva — a painting, unlike the sheets.
  "maria-tenisheva-by-i-repin-1898-gtg": "1800-1899 painting realism",

  // Manuscript illuminations: no artist, and the date sits mid-sentence.
  "an-exorcism-detail-france-ca-1480-paris-bibliotheque-nationa":
    "1400-1599 painting early-renaissance",
  "illustration-depicting-dante-and-virgil-leaving-hell-from-da":
    "1400-1599 painting early-renaissance",

  // Charles Cordier's bust — sculpture, so object rather than painting.
  "bust-of-said-abdullah-of-the-darfour-people-1848": "1800-1899 object realism",

  // Dates the year parser cannot read: "1200–900 BC", "c. 101 CE", "15th century".
  "obese-figure-1200-900-bc-early-formative-culture-olmec-style": "pre-1400 object ancient",
  "mummy-portrait": "pre-1400 painting ancient",
  "deer-mandala": "1400-1599 painting east-asian",

  // A photograph of an excavation, and a piece of Viennese table glass.
  "discovery-of-the-statue-of-antinous-at-the-temple-of-apollo-":
    "1800-1899 photograph documentary",
  "j-l-lobmeyr-pink-champagne-glass-circa-1900": "1900-1940 object other",

  // A Persian royal manuscript — outside every movement in the vocabulary.
  "anonymous-from-the-shahinshahnameh-1810": "1800-1899 painting other",

  // "1598-1652" in the filename is Chen Hongshou's lifespan, not the album's date.
  "chen-hongshou-paintings-after-ancient-masters-a-bird-and-pea": "1600-1699 painting east-asian",

  // El Lissitzky's photomontage of Schwitters: photographic, though he is a
  // designer everywhere else in the collection.
  "lissitzky-schwitters": "1900-1940 photograph modern-photography",

  // Film and TV frames whose captions name only the title, so the artist scan
  // has nothing to find. The year in the caption is the release, which is right.
  "toystory-equilibrium": "1941-1999 film-still screen",
  "toystory-disruption": "1941-1999 film-still screen",
  "toystory-recognition": "1941-1999 film-still screen",
  "toystory-repair": "1941-1999 film-still screen",
  "toystory-new-equilibrium": "1941-1999 film-still screen",
  "goodfellas-copacabana-1": "1941-1999 film-still screen",
  "goodfellas-copacabana-2": "1941-1999 film-still screen",
  "goodfellas-copacabana-3": "1941-1999 film-still screen",
  "gbh-overhead": "2000-now film-still screen",
  "gbh-concierge": "2000-now film-still screen",
  "adolescence-interview": "2000-now film-still screen",
  "lupin-vitrine": "2000-now film-still screen",
  "lupin-assane": "2000-now film-still screen",
  // Morley's broadcast ran 1969–1983; the caption carries no year.
  "nationwide-title": "1941-1999 film-still screen",

  // Production photographs — the subject is the making, not the finished frame.
  // adolescence-one-take shows the crew carrying the rig, not the shot they got.
  "jaws-bts": "1941-1999 bts screen",
  "adolescence-one-take": "2000-now bts screen",
  "foley-room": "2000-now bts screen",

  // Advertising and magazine covers. The undated Cosmopolitan is the Aug/Sep
  // 2026 issue (masthead date on the plate itself).
  "ad-sauvage": "2000-now advert contemporary",
  "ad-jadore": "2000-now advert contemporary",
  "cosmopolitan-cover": "2000-now advert contemporary",
  "glamour-cover": "2000-now advert contemporary",

  // Frames 2 and 3 of the Weems triptych carry no date; the series is 1990.
  "weems-triptych-2": "1941-1999 photograph contemporary",
  "weems-triptych-3": "1941-1999 photograph contemporary",
}

// ── Resolution ───────────────────────────────────────────────────────────────

// The date the caption states, if it states one a machine can read. Only 1200–2026
// counts as a year, which keeps plate dimensions and inventory numbers out; the
// first such token wins, because the date follows the title and any prose after it
// (the heroes carry a teaching note) may mention other years. No word boundary on
// the tail — a decade is written "1650s", and \b would refuse it.
export function yearFromCaption(caption) {
  const m = caption.match(/\b(1[2-9]\d{2}|20[0-2]\d)(?!\d)/)
  return m ? +m[1] : null
}

export function eraOf(year) {
  if (year === null) return null
  let key = null
  for (const [k, , from] of ERAS) if (year >= from) key = k
  return key
}

// Longest name wins at a given position, earliest position wins overall: a caption
// that reads "The Pulpit, Fort Fisher, Alexander Gardner, Timothy O'Sullivan" names
// the photographer first and the man in the frame second.
// Normalised to NFC first: the filenames come off several machines and some spell
// "Kertész" as e + combining acute, which no amount of lowercasing will match
// against the composed é in the table above.
function artistIn(caption) {
  const hay = caption.normalize("NFC").toLowerCase()
  let best = null
  for (const name of Object.keys(ARTISTS)) {
    const at = hay.indexOf(name.normalize("NFC").toLowerCase())
    if (at === -1) continue
    if (!best || at < best.at || (at === best.at && name.length > best.name.length))
      best = { at, name }
  }
  return best?.name ?? null
}

// era · medium · movement for one plate, from the strongest evidence available.
export function classify(slug, caption, folder = null) {
  if (SLUGS[slug]) return SLUGS[slug]

  const artist = artistIn(caption)
  const a = artist ? ARTISTS[artist] : null
  const f = folder ? FOLDERS[folder] : null

  let year = yearFromCaption(caption)
  if (a) {
    const [, , from, to] = a
    // Outside the artist's working life the date is the filename's, not the work's.
    if (year === null || year < from || year > to) year = Math.round((from + to) / 2)
  }

  const medium = a?.[0] ?? f?.[0] ?? null
  const movement = a?.[1] ?? f?.[1] ?? null
  const era = eraOf(year)
  return era && medium && movement ? `${era} ${medium} ${movement}` : null
}

// ── Regenerating library-taxonomy.json ───────────────────────────────────────

const read = async (f) => JSON.parse(await readFile(join(HERE, f), "utf8"))

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes("--all")
  const credits = await read("credits.json")
  const libCredits = await read("library-credits.json").catch(() => ({}))
  const existing = all ? {} : await read("library-taxonomy.json").catch(() => ({}))

  // Source folders come from the local index; without it (a fresh checkout) every
  // plate still classifies, just without the folder as a fallback.
  const folders = new Map()
  try {
    const index = await read("image-library.json")
    const slugify = (s) =>
      s
        .toLowerCase()
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
    for (const it of index.items) {
      const s = slugify(it.path.split("/").pop())
      if (!folders.has(s)) folders.set(s, it.category)
    }
  } catch {
    console.warn("no image-library.json — classifying without source folders")
  }

  const out = {}
  const unresolved = []
  for (const [slug, caption] of [...Object.entries(credits), ...Object.entries(libCredits)]) {
    if (existing[slug]) {
      out[slug] = existing[slug]
      continue
    }
    const got = classify(slug, caption, folders.get(slug.replace(/-x+$/, "")) ?? null)
    if (got) out[slug] = got
    else unresolved.push(`${slug}  ::  ${caption}`)
  }

  await writeFile(join(HERE, "library-taxonomy.json"), JSON.stringify(out, null, 2) + "\n")
  const tally = (i) =>
    Object.values(out).reduce(
      (m, v) => ((m[v.split(" ")[i]] = (m[v.split(" ")[i]] || 0) + 1), m),
      {},
    )
  console.log(`classified ${Object.keys(out).length} plates → library-taxonomy.json`)
  console.log("era:      ", tally(0))
  console.log("medium:   ", tally(1))
  console.log("movement: ", tally(2))
  if (unresolved.length) {
    console.log(`\n${unresolved.length} unresolved — add a SLUGS entry for each:`)
    for (const u of unresolved) console.log("  " + u)
  }
}
