// Lesson slide decks: vault → content/decks/, and the download line that goes on
// each lesson page.
//
// The decks are plain binaries — the vault builds them, this module only carries
// them through. They land in content/ (not quartz/static/) on purpose: auto-sync
// commits content/ and ignores it in its dirty check, so a deck that changes gets
// published by the unattended 07:00 run with no other moving parts. Quartz's
// Assets emitter copies every non-.md file in content/ to the output, so
// content/decks/<course>/x.pptx is served at /decks/<course>/x.pptx.
//
// Two subfolders of each vault decks/ directory are source material, not
// deliverables, and never ship: _build/ (build scripts, collegiate.js, verify.py)
// and _assets/ (full-resolution sources). Their .md files are excluded by
// DROP_DIRS in sync.mjs; the binaries here are never recursed into, because only
// top-level *.pptx files in decks/ are collected.

import { readdir, readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join, basename } from "node:path"

// Where decks live under content/, and therefore the URL prefix they're served at.
export const DECKS_DIR = "decks"
export const CREDITS_REL = `${DECKS_DIR}/credits.md`

// A deck belongs to the lesson whose filename carries the same
// `s<N>-lesson-<NN>-<slug>` tail. The prefix differs on the two sides — decks are
// named for the course ("media-studies-…"), lesson plans for the syllabus code
// ("9607-…") — so the join ignores everything before the tail.
const LESSON_KEY = /(s\d+-lesson-\d+-.+)$/
const lessonKey = (stem) => stem.match(LESSON_KEY)?.[1] ?? null

// Not every deck belongs to a lesson. The two studio courses teach in doubles —
// a three-hour session at the easel does not want slides — so they deck at the
// course level instead: an orientation (`intro-01-…`) and one brief per
// attainment (`s1-a3-…`). Those decks belong to the course, and are published on
// its overview page rather than on any one lesson.
//
// A deck that carries neither a lesson key nor one of these two shapes is still
// a ⚠. That is the point of matching on shape rather than just "no lesson key":
// a lesson deck with a typo in its tail must not quietly reclassify itself as a
// course deck and ship unlinked, and a genuinely new kind of course deck should
// be a decision someone makes here rather than a silent pass.
const COURSE_KEY = /(?:^|-)(intro-\d+|s\d+-a\d+)-(.+)$/

// Cosmetic casing the slug can't carry. Same spirit as CREDITS_FIXES below: if
// one stops matching, the worst case is a slightly odd label on a download link.
const TITLE_FIXES = [[/\ba level\b/i, "A Level"]]

const sentence = (slug) => {
  const s = slug.replace(/-/g, " ")
  return TITLE_FIXES.reduce((t, [p, r]) => t.replace(p, r), s[0].toUpperCase() + s.slice(1))
}

// { kind, label } for a course deck, or null if the stem is neither shape. The
// assignment number is kept in the label because it is what the assessment
// register calls the same piece of work; an intro deck is just its own sentence.
function courseDeck(stem) {
  const m = stem.match(COURSE_KEY)
  if (!m) return null
  const [, marker, slug] = m
  const a = marker.match(/^s\d+-a(\d+)$/)
  return a
    ? { kind: "assignment", label: `A${a[1]} ${sentence(slug)}` }
    : { kind: "intro", label: sentence(slug) }
}

// Lesson keys that intentionally ship no deck. Without this, a lesson sitting in
// a course whose other lessons all have decks is reported as a gap (⚠) and the
// unattended run refuses to publish — which is what you want for a deck that
// failed to build, and not what you want for a lesson that is a written exam.
// Add the key (the `s1-lesson-07-…` tail) here to declare the gap deliberate.
export const DECK_EXCEPTIONS = new Set([])

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

export const kb = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

// Every top-level .pptx in each course's vault decks/ directory. Courses without
// one are simply absent — most courses have no decks, and that is not a problem.
async function readSourceDecks(vault, courses) {
  const decks = []
  for (const course of Object.values(courses)) {
    const dir = join(vault, course.dir, DECKS_DIR)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // no decks for this course
    }
    const folder = basename(course.dir)
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".pptx")) continue
      const stem = entry.name.replace(/\.pptx$/, "")
      const key = lessonKey(stem)
      decks.push({
        course: course.dir,
        courseName: course.name,
        folder,
        file: entry.name,
        src: join(dir, entry.name),
        key,
        // Only decks with no lesson of their own are tested for a course shape,
        // so a lesson deck can never be read as one.
        ...(key ? {} : (courseDeck(stem) ?? {})),
      })
    }
  }
  return decks.sort((a, b) => a.file.localeCompare(b.file))
}

// Make content/decks/ hold exactly `decks`, copying only what actually differs.
// Byte-comparing rather than blind-copying matters twice over: this repo sits in
// a cloud-synced folder (a daily 44 MB rewrite would be re-uploaded every day),
// and an unchanged deck must not produce a git blob.
async function reconcile(outRoot, decks) {
  const root = join(outRoot, DECKS_DIR)
  const wanted = new Map(decks.map((d) => [`${d.folder}/${d.file}`, d]))
  const copied = []
  const removed = []

  const existing = new Map()
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue
    for (const entry of await readdir(join(root, folder.name), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".pptx"))
        existing.set(`${folder.name}/${entry.name}`, join(root, folder.name, entry.name))
    }
  }

  for (const [rel, path] of existing) {
    if (wanted.has(rel)) continue
    await rm(path)
    removed.push(rel)
  }

  for (const [rel, deck] of wanted) {
    const bytes = await readFile(deck.src)
    deck.size = bytes.length
    const current = existing.get(rel)
    if (current && sha256(await readFile(current)) === sha256(bytes)) continue
    const dest = join(root, rel)
    await mkdir(join(root, deck.folder), { recursive: true })
    await copyFile(deck.src, dest)
    copied.push(rel)
  }

  // Leave no empty course folders behind after a set is retired.
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue
    const left = await readdir(join(root, folder.name))
    if (!left.length) await rm(join(root, folder.name), { recursive: true })
  }

  return { copied, removed }
}

// The download line, mirroring the handout line's markup so the two match.
export function deckLine(deck, depth) {
  const prefix = "../".repeat(depth)
  const href = `${prefix}${DECKS_DIR}/${deck.folder}/${deck.file}`
  const credits = `${prefix}${DECKS_DIR}/credits`
  return (
    `<p class="handouts"><strong>Lesson slides:</strong> ` +
    `<a href="${href}">Download the deck (PowerPoint, ${kb(deck.size)})</a> · ` +
    `<a href="${credits}">image credits</a></p>\n`
  )
}

// The course decks, for the course overview page — the one page every student of
// that course lands on, and the only place these can be found, since the courses
// that have them publish no lesson decks to hang a download line from. One line
// per kind, mirroring the handout line's markup; sizes are left off because six
// of them in a row is noise, not information.
export function courseDeckBlock(decks, depth) {
  const prefix = "../".repeat(depth)
  const groups = [
    ["Course slides (PowerPoint):", decks.filter((d) => d.kind === "intro")],
    ["Assignment briefs (PowerPoint):", decks.filter((d) => d.kind === "assignment")],
  ].filter(([, ds]) => ds.length)
  if (!groups.length) return ""

  const lines = groups.map(([title, ds], i) => {
    const links = ds.map(
      (d) => `<a href="${prefix}${DECKS_DIR}/${d.folder}/${d.file}">${d.label}</a>`,
    )
    // Credits once, at the end of the block rather than on every line.
    if (i === groups.length - 1)
      links.push(`<a href="${prefix}${DECKS_DIR}/credits">image credits</a>`)
    return `<p class="handouts"><strong>${title}</strong> ${links.join(" · ")}</p>`
  })
  return lines.join("\n") + "\n\n"
}

// Each course's own framing for its credits. The vault's CREDITS.md files open
// with a preamble written for whoever rebuilds the decks — which folder the
// sources sit in, what is duplicated where — so the preamble is cut and replaced
// with these. What survives the cut is the part a reader wants: the lists of works.
const CREDITS_INTRO = {
  "classes/a-level-art-design":
    "Every plate in the A Level intro and assignment decks is public domain and came " +
    "from the school image library; nothing was downloaded for them.",
  "classes/pre-a-level-art-design":
    "Every plate in the Pre A Level intro decks is public domain and came from the " +
    "school image library; nothing was downloaded for them.",
  "classes/art-appreciation":
    "Works downloaded for the Art Appreciation decks — the lessons whose art the " +
    "school's image library did not already hold. Everything else in those decks " +
    "comes from the library.",
  "classes/media-studies":
    "Media Studies is a subject about contemporary, copyrighted media, so the decks " +
    "reproduce none of it: those texts are named on labelled slides and shown in " +
    "class. Every image slide uses a public-domain work chosen to illustrate the " +
    "concept instead.",
}

// Cosmetic fixes to the surviving text: the vault writes about its own folders,
// which means nothing to a reader here. Each is an exact string; if the vault
// rewords one, the worst case is a slightly odd heading, not a broken page.
const CREDITS_FIXES = [
  [/^(#+) From the local library.*$/m, "$1 From the school image library"],
  [/\s*\(kept in this folder\)/g, ""],
  [/`raw\/shared\/Image Slides\/?`/g, "the school image library"],
]

// The credits page, assembled from each course's decks/_assets/CREDITS.md — the
// provenance record for every image in the decks, published so a student who
// downloads one can see where its artwork came from. Everything before the first
// section heading or table is the build preamble and is dropped; what remains is
// demoted one level to sit under this page's own headings.
async function creditsPage(vault, courses, coursesWithDecks) {
  const sections = []
  for (const course of Object.values(courses)) {
    if (!coursesWithDecks.has(course.dir)) continue
    const path = join(vault, course.dir, DECKS_DIR, "_assets", "CREDITS.md")
    let text
    try {
      text = await readFile(path, "utf8")
    } catch {
      continue
    }
    const start = text.search(/^(#{2,}\s|\|)/m)
    let body = (start === -1 ? text.replace(/^#\s+.*\n/, "") : text.slice(start)).trim()
    body = body.replace(/^(#+)/gm, "#$1")
    for (const [pattern, replacement] of CREDITS_FIXES) body = body.replace(pattern, replacement)
    const intro = CREDITS_INTRO[course.dir]
    sections.push(`## ${course.name}\n\n` + (intro ? `${intro}\n\n` : "") + `${body}\n`)
  }
  if (!sections.length) return null
  return (
    `---\ntitle: "Lesson slides — image credits"\n---\n` +
    `# Lesson slides — image credits\n\n` +
    `Every work reproduced in the lesson decks, course by course, with its source.\n` +
    `All of them are public domain except one Creative Commons photograph, which is\n` +
    `credited on its own slide as the licence requires.\n\n` +
    sections.join("\n")
  )
}

// Copy the decks through and work out which lesson page gets which one.
//
// Returns `byLesson` (lesson rel → deck, for the download lines), a `summary`
// line for the run log, and `warnings`. A warning is a ⚠ line, which stops
// auto-sync from publishing the run: both cases mean a student-facing link would
// be wrong or missing, and both are fixed in the vault, not here.
export async function syncDecks({ vault, out, courses, lessonRels }) {
  const decks = await readSourceDecks(vault, courses)
  const warnings = []

  const lessons = new Map() // key → lesson rel
  for (const rel of lessonRels) {
    const key = lessonKey(basename(rel, ".md"))
    if (key) lessons.set(key, rel)
  }

  const byLesson = new Map()
  const byCourse = new Map() // course dir → its course decks, in filename order
  for (const deck of decks) {
    if (deck.key) {
      const rel = lessons.get(deck.key)
      if (!rel) {
        warnings.push(
          `⚠ deck ${deck.file} matches no published lesson page — it would ship with no link to it`,
        )
        continue
      }
      byLesson.set(rel, deck)
      continue
    }
    if (!deck.kind) {
      warnings.push(
        `⚠ deck ${deck.file} belongs to no lesson, and its name is not a course-deck ` +
          `shape (intro-NN-… or sN-aN-…) — it would ship with no link to it`,
      )
      continue
    }
    if (!byCourse.has(deck.course)) byCourse.set(deck.course, [])
    byCourse.get(deck.course).push(deck)
  }

  const { copied, removed } = await reconcile(out, decks)

  // Gaps: a lesson in a course that decks its lessons, but with no deck of its
  // own. Scoped to courses that actually have lesson decks, so a course that
  // decks at the course level isn't asked for 55 lesson decks it never wanted.
  // This keeps the check pointed at what it is for — one deck of sixteen failing
  // to build still warns, because the other fifteen hold the course in the set.
  const lessonDeckCourses = new Set([...byLesson.values()].map((d) => d.course))
  const perCourse = new Map()
  for (const dir of lessonDeckCourses) perCourse.set(dir, { have: 0, missing: [] })
  for (const [key, rel] of lessons) {
    const dir = [...lessonDeckCourses].find((d) => rel.startsWith(d + "/"))
    if (!dir) continue
    if (byLesson.has(rel)) perCourse.get(dir).have++
    else if (!DECK_EXCEPTIONS.has(key)) perCourse.get(dir).missing.push(key)
  }
  for (const [dir, stat] of perCourse) {
    if (!stat.missing.length) continue
    warnings.push(
      `⚠ ${dir}: no deck for ${stat.missing.join(", ")} — rebuild it, or add the key ` +
        `to DECK_EXCEPTIONS in decks.mjs if the lesson is meant to have none`,
    )
  }

  // Credits cover every course that ships a deck of either kind.
  const coursesWithDecks = new Set([...lessonDeckCourses, ...byCourse.keys()])
  const credits = await creditsPage(vault, courses, coursesWithDecks)
  if (credits) {
    await mkdir(join(out, DECKS_DIR), { recursive: true })
    await writeFile(join(out, CREDITS_REL), credits)
  }

  const coverage = [...perCourse]
    .map(([dir, s]) => `${basename(dir)} ${s.have}/${s.have + s.missing.length}`)
    .join(", ")
  const churn = [
    copied.length ? `${copied.length} copied` : "",
    removed.length ? `${removed.length} removed` : "",
  ]
    .filter(Boolean)
    .join(", ")
  // Course decks are counted separately: they have no lesson to be measured
  // against, so a "15/15" would mean nothing for them.
  const courseDecks = [...byCourse.values()].flat()
  const courseCoverage = [...byCourse]
    .map(([dir, ds]) => `${basename(dir)} ${ds.length}`)
    .join(", ")
  const summary =
    `Published ${byLesson.size} lesson deck(s)` +
    (coverage ? ` (${coverage})` : "") +
    (courseDecks.length ? ` and ${courseDecks.length} course deck(s) (${courseCoverage})` : "") +
    (churn ? ` — ${churn}` : " — unchanged") +
    "."

  return { byLesson, byCourse, credits: credits ? CREDITS_REL : null, warnings, summary, removed }
}
