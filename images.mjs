#!/usr/bin/env node
// Select artworks from the shared Image Slides library, resize them for the web,
// and write them into the site's static directory with credits.
//
// The library is 7.2 GB of museum scans (one file is 38,414 px wide). Nothing is
// served from it directly — everything here is downsampled to web size first.
//
// Selection was restricted to work published before ~1930 (public domain in the
// relevant jurisdictions) plus works of the US federal government (FSA photography:
// Lange's Migrant Mother), which are public domain by statute regardless of date.
//
// That rule was lifted on 2026-08-08. It was excluding the works the lessons
// actually teach: Duchamp's Fountain from the artworld lesson, Weems's Kitchen
// Table Series from food and ethics, Sherman from the gaze, and most of the 191
// photographer folders in the library. The site is behind a site-wide password
// gate (middleware.ts, fails closed) and serves one teacher's classes, so it now
// follows the same standing that governs the classroom and the decks: teaching
// use is cleared. Choose the work the lesson teaches; do not substitute a
// public-domain neighbour for it.
//
// Two source roots. `file` resolves against the shared Image Slides library by
// default. `root: "sourced"` resolves against ./sourced, which holds public-domain
// works fetched from Wikimedia Commons because the library lacks them (Titian's
// Venus of Urbino, Manet's Olympia, and the rest of the Berger set). Anything in
// ./sourced is public domain and safe to keep in the repo.

import { execFile } from "node:child_process"
import { mkdir, writeFile, access } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const LIB = "/Users/dogan/Documents/Vaults/Courses/raw/shared/Image Slides"
const SOURCED = join(import.meta.dirname, "sourced")
const OUT = join(import.meta.dirname, "quartz/static/img")
const ROOTS = { library: LIB, sourced: SOURCED }

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
    slug: "heda-still-life",
    file: "Dutch and Flemish Still Life Painting (Art Paintings)/Willem Claesz. Heda (1593-94 - 1680)/Still life with golden tableware (1635) (88 x 113) (Amsterdam, The State. Museum).jpg",
    credit: "Willem Claesz. Heda, *Still Life with a Gilt Cup*, 1635",
  },
  {
    slug: "last-supper",
    file: "Leonardo DaVinci, The Last Supper, 1495-1498, fresco.jpg",
    credit: "Leonardo da Vinci, *The Last Supper*, 1495–98",
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
  {
    slug: "repin-nevsky-studies",
    file: "Ilya Repin (Drawings)/Ilya Repin, Studies for Figures on the Nevsky Prospect in St. Petersburg, 1891.jpg",
    credit: "Ilya Repin, *Studies for Figures on the Nevsky Prospect*, 1891",
  },
  {
    slug: "repin-cossacks-study",
    file: "Ilya Repin (Drawings)/Ilya Repin, Study for Zaporozhian Cossacks Writing a Letter to the Turkish Sultan, 1878.jpg",
    credit: "Ilya Repin, study for *Reply of the Zaporozhian Cossacks*, 1878",
  },
  {
    slug: "van-gogh-armchair",
    file: "Vincent van Gogh, Paul Gauguin's Armchair, 1888.jpeg",
    credit: "Vincent van Gogh, *Paul Gauguin's Armchair*, 1888",
  },
  {
    slug: "van-gogh-outskirts",
    file: "Vincent Van Gogh, On the Outskirts of Paris, 1887.jpg",
    credit: "Vincent van Gogh, *On the Outskirts of Paris*, 1887",
  },
  {
    slug: "cafe-terrace",
    file: "Vincent van Gogh, Café Terrace at Night (Place du Forum, Arles), 1888.jpeg",
    credit: "Vincent van Gogh, *Café Terrace at Night*, 1888",
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
    credit:
      "El Lissitzky, *Kurt Schwitters*, c. 1924 — a photomontage portrait of the great collagist",
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
    credit:
      "Ambrosius Bosschaert the Elder, *A Still Life of Flowers*, 1609–10 — flowers that never bloom together, composed anyway",
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
    credit:
      "Émile Gsell, photographic advertisement, 1860s — one name card commanding a hundred photographs",
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
  // ── The works the lessons actually teach (added 2026-08-08) ────────────────
  // Already in the library; the pre-1930 rule was the only thing withholding them.
  {
    slug: "duchamp-fountain",
    file: "Marcel Duchamp, Fountain, 1917.jpeg",
    credit: "Marcel Duchamp, *Fountain*, 1917. The object that made looking insufficient",
  },
  {
    slug: "weems-kitchen-table",
    file: "Photographers/Carrie Mae Weems/Carrie Mae Weems, The Kitchen Table Series, 1990.jpg",
    credit:
      "Carrie Mae Weems, from *The Kitchen Table Series*, 1990. One table, one light, the whole argument",
  },
  {
    slug: "sherman-film-still",
    file: "Photographers/Cindy Sherman/Cindy Sherman Untitled Film Still #48 1979.png",
    credit:
      "Cindy Sherman, *Untitled Film Still #48*, 1979. A film that does not exist, and you know the character anyway",
  },
  // Public domain, absent from the library, fetched from Wikimedia Commons.
  {
    slug: "venus-of-urbino",
    root: "sourced",
    file: "venus-of-urbino.jpg",
    credit: "Titian, *Venus of Urbino*, 1534. What does it ask you to accept as natural?",
  },
  {
    slug: "olympia",
    root: "sourced",
    file: "olympia.jpg",
    credit: "Édouard Manet, *Olympia*, 1863. Every refusal is findable in the paint",
  },
  {
    slug: "gentileschi-judith",
    root: "sourced",
    file: "gentileschi-judith.jpg",
    credit: "Artemisia Gentileschi, *Judith Beheading Holofernes*, c. 1620",
  },
  {
    slug: "le-gras",
    root: "sourced",
    file: "le-gras.jpg",
    credit:
      "Joseph Nicéphore Niépce, *View from the Window at Le Gras*, 1826. The first photograph, and eight hours of light",
  },
  {
    slug: "wheatfield-crows",
    root: "sourced",
    file: "wheatfield-crows.jpg",
    credit:
      "Vincent van Gogh, *Wheatfield with Crows*, 1890. Berger's demonstration: the painting, then the painting with a caption",
  },
  {
    slug: "virgin-rocks-london",
    root: "sourced",
    file: "virgin-rocks-london.jpg",
    credit: "Leonardo da Vinci, *The Virgin of the Rocks*, c. 1495–1508 (National Gallery, London)",
  },
  {
    slug: "virgin-rocks-louvre",
    root: "sourced",
    file: "virgin-rocks-louvre.jpg",
    credit:
      "Leonardo da Vinci, *The Virgin of the Rocks*, c. 1483–86 (Louvre, Paris). Two originals, and reproduction makes them one image",
  },
  {
    slug: "venus-and-mars",
    root: "sourced",
    file: "venus-and-mars.jpg",
    credit: "Sandro Botticelli, *Venus and Mars*, c. 1485. Berger's cropping demonstration",
  },
  // ── 9607 contemporary texts (added 2026-08-08) ─────────────────────────────
  // Supplied by the teacher into "Film & TV/". These are the texts the lessons
  // actually teach; the pre-1930 plates that stood in for them were unrelated.
  // Todorov's five stages, in the order the coursebook works them (§3.2).
  {
    slug: "toystory-equilibrium",
    file: "Film & TV/Toy Story/toystory_staffmeeting.png",
    credit: "*Toy Story* (1995), stage 1. Equilibrium: the staff meeting, before anything breaks",
  },
  {
    slug: "toystory-disruption",
    file: "Film & TV/Toy Story/toystory_buzzunwrapped.png",
    credit: "*Toy Story* (1995), stage 2. Disruption: Buzz arrives and displaces Woody",
  },
  {
    slug: "toystory-recognition",
    file: "Film & TV/Toy Story/toystory_woodykicksbuzzout3.png",
    credit:
      "*Toy Story* (1995), stage 3. Recognition: the rivalry breaks open and Buzz goes out the window",
  },
  {
    slug: "toystory-repair",
    file: "Film & TV/Toy Story/toystory_sidshouse.png",
    credit: "*Toy Story* (1995), stage 4. Repair: lost in Sid's house, working the way back",
  },
  {
    slug: "toystory-new-equilibrium",
    file: "Film & TV/Toy Story/toystory_reunited.png",
    credit: "*Toy Story* (1995), stage 5. New equilibrium: the rivals, now a pair",
  },
  // The Copacabana steadicam, read as one move in three places.
  {
    slug: "goodfellas-copacabana-1",
    file: "Film & TV/Goodfellas/goodfellas_copacabana 1.png",
    credit: "*Goodfellas* (1990). The Copacabana take begins on the street",
  },
  {
    slug: "goodfellas-copacabana-2",
    file: "Film & TV/Goodfellas/goodfellas_copacabana 2.png",
    credit: "*Goodfellas* (1990). The same unbroken shot, through the service corridor",
  },
  {
    slug: "goodfellas-copacabana-3",
    file: "Film & TV/Goodfellas/goodfellas1.jpg.webp",
    credit: "*Goodfellas* (1990). One continuous move, ending at the table",
  },
  {
    slug: "adolescence-one-take",
    file: "Film & TV/Adolescence/adolescence_behindthescene.png",
    credit: "*Adolescence* (2025). The camera is carried, not cut: the rig crossing a street scene",
  },
  {
    slug: "adolescence-interview",
    file: "Film & TV/Adolescence/adolescence_filmstill2.png",
    credit:
      "*Adolescence* (2025). Blocking for a continuous take: three people, one room, no cutaway",
  },
  // ── Second teacher delivery, 2026-08-08 ────────────────────────────────────
  // The French Netflix *Lupin*, which is the series the Cambridge U3 notes work
  // (not the anime of the same name).
  {
    slug: "lupin-vitrine",
    file: "Film & TV/Lupin/66dbbdfa-0834-4dc9-9455-f6edce7788c2.avif",
    credit:
      "*Lupin* (2021). Assane in the museum, dressed to be unseen: wealth against poverty, and the thief against the hero, in one frame",
  },
  {
    slug: "lupin-assane",
    file: "Film & TV/Lupin/Lupin_305_Unit_02043.webp",
    credit: "*Lupin* (2021). The same man, dressed to be seen",
  },
  // L09 van Zoonen: one house, one season, opposite conventions, so the swap
  // isolates the performance and not the budget.
  {
    slug: "ad-sauvage",
    file: "Print & Advertising/Ads/sauvage.webp",
    credit: "Dior, *Sauvage*. Full face, direct address, landscape, subject as agent",
  },
  {
    slug: "ad-jadore",
    file: "Print & Advertising/Ads/jadore.webp",
    credit: "Dior, *J'adore*. Gold, averted eyes, the body as surface",
  },
  {
    slug: "nationwide-title",
    file: "Film & TV/Nationwide/nationwide_title.png",
    credit: "*Nationwide* (BBC). The broadcast on which Morley tested differential readings",
  },
  {
    slug: "rosler-kitchen",
    file: "Martha Rosler, Semiotics of the Kitchen, 1975.png",
    credit:
      "Martha Rosler, *Semiotics of the Kitchen*, 1975. A kitchen turned into an alphabet of rage",
  },
  {
    slug: "warhol-brillo",
    file: "Andy Warhol, Brillo Boxes, 1964.jpg",
    credit: "Andy Warhol, *Brillo Boxes*, 1964. The object Danto wrote 'The Artworld' about",
  },
  {
    slug: "berger-ways-of-seeing",
    file: "Unsorted/John Berger, Ways of Seeing(still).png",
    credit: "John Berger, *Ways of Seeing* (BBC, 1972)",
  },
  {
    slug: "goodbye-to-language",
    file: "Film & TV/Goodbye to Language/2019-01-16 (15).png",
    credit: "Jean-Luc Godard, *Goodbye to Language*, 2014. An image that refuses to add up",
  },
  {
    slug: "eat-drink-man-woman",
    file: "Film & TV/Eat Drink Man Woman/eatdrinkmanwoman_opening.png",
    credit: "Ang Lee, *Eat Drink Man Woman*, 1994. The table is easier to see when it is moving",
  },
  {
    slug: "edmw-dinner",
    file: "Film & TV/Eat Drink Man Woman/eatdrinkmanwoman_dinner.png",
    credit: "Ang Lee, *Eat Drink Man Woman*, 1994. The Sunday dinner, where the rules get enforced",
  },
  {
    slug: "la-chimera",
    file: "Film & TV/La Chimera/La Chimera Scene 2.png",
    credit: "Alice Rohrwacher, *La Chimera*, 2023",
  },
  // PAL U3: the collage plate the credits file has been recording as missing.
  {
    slug: "bearden-block",
    file: "Romare Bearden, The Block, 1971.jpg",
    credit: "Romare Bearden, *The Block*, 1971. Six panels, one street, cut and reassembled",
  },
  {
    slug: "bearden-musicians",
    file: "Romare Bearden, Three Folk Musicians, 1967, collage of various papers with paint and graphite on canvas.jpg",
    credit: "Romare Bearden, *Three Folk Musicians*, 1967",
  },
  {
    slug: "hoch-kitchen-knife",
    file: "Hannah Höch, Cut with the Kitchen Knife Dada Through the Last Weimar Beer-Belly Cultural Epoch in Germany, collage, mixed media, 1919-1920.jpg",
    credit: "Hannah Höch, *Cut with the Kitchen Knife*, 1919",
  },
  {
    slug: "cosmopolitan-cover",
    file: "Print & Advertising/Cosmopolitan/cosmopolitan-magazine-cover.avif",
    credit: "*Cosmopolitan*, cover",
  },
  {
    slug: "glamour-cover",
    file: "Print & Advertising/Glamour/Cover-Rita_glamour_5aug15_pr_b.webp",
    credit: "*Glamour*, cover, August 2015",
  },
]

await mkdir(OUT, { recursive: true })

const credits = {}
for (const plate of PLATES) {
  const src = join(ROOTS[plate.root ?? "library"], plate.file)
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
    await run("sips", [
      ...fmt,
      "-c",
      String(plate.crop[0]),
      String(plate.crop[1]),
      src,
      "--out",
      dest,
    ])
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
